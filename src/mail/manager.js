/**
 * Email IMAP (F3) — CHỈ ĐỌC: kéo thư mới trong hộp thư đã cấu hình, gom theo chuỗi (References / In-Reply-To / tiêu đề) và ghi
 * vào CÙNG bảng hội thoại với Zalo/Telegram (account_id = "mail:<địa chỉ>", thread_id = "mail:<mã chuỗi>", is_group = 0), nhờ đó
 * danh sách hội thoại, gói du-lieu/, AI cục bộ và báo cáo ngày dùng nguyên không sửa. Không đánh dấu đã đọc (BODY.PEEK), không gửi.
 * Trạng thái (UID cuối theo hộp thư, lần đồng bộ) ở data/mail.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { previewOf } from '../zalo/normalize.js';
import { friendlyError } from '../integrations.js';

export const MAIL_PREFIX = 'mail:';
export const isMailAccount = (id) => String(id ?? '').startsWith(MAIL_PREFIX);
const SYNC_MINUTES = 15;
const MAX_SOURCE_BYTES = 400_000;   // thư dài hơn thì cắt (đủ phần chữ, bỏ đính kèm nặng)
const MAX_BODY_CHARS = 6000;
const MAX_PER_SYNC = 400;

const RE_PREFIX = /^\s*((re|fw|fwd|tr|aw|wg|sv|vs|trả lời|chuyển tiếp|phản hồi)\s*:\s*)+/i;
export const normalizeSubject = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(RE_PREFIX, '').replace(/^\[[^\]]{1,40}\]\s*/, '').trim();
const short = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const addrText = (a) => (a?.value ?? []).map((x) => x.name ? `${x.name} <${x.address}>` : x.address).join(', ');

/** Bỏ phần trích dẫn thư cũ (dòng bắt đầu bằng >, khối "On … wrote:", "-----Original Message-----", "Từ: … Đã gửi:") để model không đọc lặp. */
export function stripQuoted(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^-{2,}\s*(Original Message|Forwarded message|Thư gốc|Tin nhắn đã chuyển tiếp)/i.test(l)) break;
    if (/^(On|Vào|Le)\s.+(wrote|đã viết|a écrit)\s*:?\s*$/i.test(l)) break;
    if (/^(From|Từ)\s*:\s.+$/i.test(l) && out.length > 3) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export class MailManager extends EventEmitter {
  constructor({ db, log, integrations, file }) {
    super();
    this.db = db; this.log = log; this.integrations = integrations; this.file = file;
    this.state = this.load();
    this.timer = null; this.syncing = false; this.lastError = null; this.lastResult = null; this.nextRunAt = null; this.fails = 0;
  }
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { boxes: {}, lastSyncAt: null }; } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 }); }
  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }

  status() {
    const cfg = this.integrations.view('email');
    return { enabled: !!cfg.enabled, configured: !!cfg.configured, account: cfg.user || null, folder: cfg.folder, days: cfg.days, host: cfg.host || null,
      syncing: this.syncing, lastSyncAt: this.state.lastSyncAt, lastResult: this.lastResult, lastError: this.lastError, nextRunAt: this.nextRunAt, everyMinutes: SYNC_MINUTES,
      totalStored: Object.values(this.state.boxes ?? {}).reduce((n, b) => n + (b.inserted ?? 0), 0) };
  }

  /** Bật lịch: chạy ngay một lượt (nếu bật) rồi mỗi 15 phút. Gọi sau khi mở khoá. */
  schedule() {
    this.stop(); this.fails = 0;
    const cfg = this.integrations.view('email');
    if (!cfg.enabled || !cfg.configured) { this.emitChange(); return; }
    this.nextRunAt = Date.now() + 5000;
    this.timer = setTimeout(() => { void this.sync('tự động'); this.timer = setInterval(() => { void this.sync('tự động'); }, SYNC_MINUTES * 60e3); this.nextRunAt = Date.now() + SYNC_MINUTES * 60e3; }, 5000);
    this.emitChange();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; this.nextRunAt = null; }

  async sync(reason = 'tay') {
    if (this.syncing) return this.status();
    const cfg = this.integrations.secrets('email');
    if (!cfg.host || !cfg.user || !cfg.password) { this.lastError = 'Chưa cấu hình email (thiếu máy chủ, tài khoản hoặc mật khẩu).'; this.emitChange(); return this.status(); }
    this.syncing = true; this.lastError = null; this.emitChange();
    const t0 = Date.now();
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');
    const { connectImap } = await import('./discover.js');
    const accountId = MAIL_PREFIX + cfg.user.toLowerCase();
    const boxKey = `${cfg.user.toLowerCase()}|${cfg.folder || 'INBOX'}`;
    const box = this.state.boxes[boxKey] ?? (this.state.boxes[boxKey] = { lastUid: 0, uidValidity: null, inserted: 0 });
    let scanned = 0, inserted = 0, client = null;
    try {
      const conn = await connectImap(ImapFlow, cfg, { probeTimeout: 3500 });
      client = conn.client;
      // Máy chủ dò được (hoặc khác bản đã lưu — vd mail.<domain> là CNAME hỏng chứng chỉ ⇒ chuyển sang máy chủ MX) thì lưu lại để lần sau vào thẳng.
      if (conn.changed) { this.integrations.set('email', conn.applied); this.log?.info(`Email: chuyển máy chủ IMAP sang ${conn.discovered}.`); }
      this.db.upsertAccount({ id: accountId, displayName: `${cfg.user} (Email)`, avatarUrl: null, phone: null, status: 'connected' });
      const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
      try {
        const uidValidity = String(client.mailbox?.uidValidity ?? '');
        if (box.uidValidity && box.uidValidity !== uidValidity) { this.log?.warn(`Email: hộp thư ${cfg.folder} đổi UIDVALIDITY — đọc lại từ đầu theo số ngày.`); box.lastUid = 0; }
        box.uidValidity = uidValidity;
        const firstRun = !box.lastUid;
        let uids;
        if (firstRun) {
          const since = new Date(Date.now() - (cfg.days || 7) * 86400e3);
          uids = await client.search({ since }, { uid: true });
        } else {
          uids = await client.search({ uid: `${box.lastUid + 1}:*` }, { uid: true });
          uids = (uids || []).filter((u) => u > box.lastUid);
        }
        uids = (uids || []).sort((a, b) => a - b);
        if (uids.length > MAX_PER_SYNC) { this.log?.info(`Email: ${uids.length} thư mới, lấy ${MAX_PER_SYNC} thư mới nhất trước.`); uids = uids.slice(-MAX_PER_SYNC); }
        let maxUid = box.lastUid;
        for (const uid of uids) {
          let msg;
          try { msg = await client.fetchOne(String(uid), { uid: true, envelope: true, internalDate: true, flags: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: true }); }
          catch (err) { this.log?.warn(`Email: không lấy được thư UID ${uid}: ${err?.message ?? err}`); continue; }
          if (!msg) continue;
          scanned++;
          try {
            const parsed = await simpleParser(msg.source ?? Buffer.alloc(0), { skipImageLinks: true, skipTextToHtml: true });
            const row = this.rowOf({ parsed, msg, cfg, accountId, source: firstRun ? 'history' : 'live' });
            if (row && this.db.insertMessage(row)) {
              inserted++;
              if (!firstRun) this.emit('message', { accountId: row.account_id, threadId: row.thread_id, isGroup: false, isOutbound: !!row.is_outbound, preview: row.preview, eventTime: row.event_time, source: 'live' });
            }
          } catch (err) { this.log?.warn(`Email: không đọc được thư UID ${uid}: ${err?.message ?? err}`); }
          if (uid > maxUid) maxUid = uid;
        }
        if (firstRun && !uids.length) { const st = await client.status(cfg.folder || 'INBOX', { uidNext: true }); maxUid = Math.max(maxUid, (st?.uidNext ?? 1) - 1); }
        box.lastUid = maxUid; box.inserted = (box.inserted ?? 0) + inserted;
      } finally { lock.release(); }
      this.state.lastSyncAt = Date.now(); this.save();
      this.lastResult = { scanned, inserted, at: Date.now(), ms: Date.now() - t0 };
      if (inserted) this.emit('message', { source: 'old_sync', count: inserted });
      this.fails = 0;
      this.log?.info(`Email (${reason}): quét ${scanned} thư, thêm ${inserted} thư mới từ ${cfg.user}/${cfg.folder} (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
    } catch (err) {
      this.lastError = friendlyError(err);
      this.fails++;
      this.log?.error(`Email (${reason}) lỗi (lần ${this.fails}): ${err?.message ?? err}`);
      // Sau 3 lần lỗi liên tiếp (thường do máy chủ tắt IMAP mật khẩu — vd Microsoft 365) thì DỪNG lịch tự động để khỏi lặp lỗi mỗi 15 phút;
      // người dùng sửa cấu hình (onChange sẽ đặt lại lịch) hoặc bấm "Đồng bộ thư ngay".
      if (this.fails >= 3 && reason === 'tự động') { this.stop(); this.lastError += ' — đã tạm dừng tự đồng bộ sau 3 lần lỗi; sửa cấu hình hoặc bấm "Đồng bộ thư ngay" để thử lại.'; }
    } finally {
      if (client) { try { await client.logout(); } catch { try { client.close(); } catch { /* bỏ qua */ } } }
      this.syncing = false; this.emitChange();
    }
    return this.status();
  }

  /** Dựng hàng tin từ một thư đã phân tích. */
  rowOf({ parsed, msg, cfg, accountId, source }) {
    const subjectRaw = parsed.subject || msg.envelope?.subject || '';
    const subject = normalizeSubject(subjectRaw) || '(không tiêu đề)';
    const refs = Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []);
    const rootId = refs[0] || parsed.inReplyTo || null;
    const threadKey = rootId ? `id:${String(rootId).trim().toLowerCase()}` : `subj:${subject.toLowerCase()}`;
    const threadId = MAIL_PREFIX + crypto.createHash('sha1').update(threadKey).digest('hex').slice(0, 16);
    const from = parsed.from?.value?.[0] ?? { address: msg.envelope?.from?.[0]?.address, name: msg.envelope?.from?.[0]?.name };
    const fromAddr = String(from?.address ?? '').toLowerCase();
    const isOut = !!fromAddr && fromAddr === String(cfg.user).toLowerCase();
    const senderName = from?.name?.trim() || fromAddr || 'Người gửi';
    let body = parsed.text || '';
    if (!body && parsed.html) body = String(parsed.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ');
    body = stripQuoted(body);
    if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS) + '\n[… thư dài, đã cắt]';
    const atts = (parsed.attachments ?? []).filter((a) => a.contentDisposition !== 'inline' || !String(a.contentType).startsWith('image/')).map((a) => ({ type: 'file', name: a.filename || 'tệp', size: a.size ?? null }));
    const head = [`Tiêu đề: ${subjectRaw.trim() || '(không tiêu đề)'}`, `Từ: ${addrText(parsed.from) || fromAddr}${parsed.to ? ` → Đến: ${short(addrText(parsed.to), 300)}` : ''}${parsed.cc ? ` · Cc: ${short(addrText(parsed.cc), 200)}` : ''}`];
    const text = `${head.join('\n')}\n\n${body || '(thư không có phần chữ)'}`;
    const when = parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : (msg.internalDate instanceof Date ? msg.internalDate : new Date());
    const msgId = (parsed.messageId || msg.envelope?.messageId || '').trim() || `uid:${msg.uid}`;
    return {
      account_id: accountId, thread_id: threadId, is_group: 0,
      zalo_msg_id: msgId, cli_msg_id: null, is_outbound: isOut ? 1 : 0,
      sender_id: fromAddr || null, sender_name: senderName,
      type: 'text', text, attachments_json: atts.length ? JSON.stringify(atts) : null,
      quote_text: null, event_time: when.getTime(), source, recalled: 0,
      raw_json: JSON.stringify({ uid: msg.uid, folder: cfg.folder, messageId: msgId, subject: subjectRaw, threadKey }),
      created_at: Date.now(), conv_name: `✉️ ${short(subject, 120)}`, conv_avatar: null, conv_phone: null,
      preview: previewOf({ type: 'text', text: `${short(subject, 60)} — ${body.replace(/\s+/g, ' ').slice(0, 80)}`, attachments: atts }),
    };
  }
}
