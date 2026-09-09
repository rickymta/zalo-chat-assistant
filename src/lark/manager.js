/**
 * Lark Approval (F4) — CHỈ ĐỌC: lấy phiếu duyệt trong N ngày (và phiếu còn chờ duyệt đã biết), đọc dòng thời gian từng phiếu và
 * ghi vào CÙNG bảng hội thoại (account_id = "lark:<app id>", thread_id = "lark:<instance code>", is_group = 1 — mỗi bước duyệt là
 * một "tin"), nên gói du-lieu/, AI cục bộ, báo cáo dùng nguyên. Tên hội thoại mang trạng thái hiện tại: "[Chờ duyệt] Đề nghị thanh toán · #123".
 * Cần ứng dụng nội bộ Lark có quyền approval:approval:readonly + approval:instance:readonly (và contact:user.base:readonly để hiện tên người).
 * Trạng thái ở data/lark.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { previewOf } from '../zalo/normalize.js';
import { larkBase } from '../integrations.js';

export const LARK_PREFIX = 'lark:';
export const isLarkAccount = (id) => String(id ?? '').startsWith(LARK_PREFIX);
const SYNC_MINUTES = 15;
const STATUS_VI = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', CANCELED: 'Đã huỷ', CANCELLED: 'Đã huỷ', DELETED: 'Đã xoá', REVERTED: 'Đã thu hồi' };
const TL_VI = {
  START: 'nộp phiếu', PASS: 'đã duyệt', REJECT: 'từ chối', AUTO_PASS: 'tự động duyệt', AUTO_REJECT: 'tự động từ chối', REMOVE_REPEAT: 'bỏ bước trùng',
  TRANSFER: 'chuyển cho người khác duyệt', ADD_APPROVER_BEFORE: 'thêm người duyệt trước', ADD_APPROVER: 'thêm người duyệt', ADD_APPROVER_AFTER: 'thêm người duyệt sau',
  DELETE_APPROVER: 'bỏ người duyệt', ROLLBACK_SELECTED: 'trả về bước đã chọn', ROLLBACK: 'trả về bước trước', CANCEL: 'huỷ phiếu', DELETE: 'xoá phiếu', CC: 'chuyển tiếp (cc)', COMMENT: 'bình luận',
};
const short = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Diễn giải biểu mẫu phiếu (chuỗi JSON các widget) thành các dòng "Tên trường: giá trị". */
export function renderForm(formJson) {
  let widgets; try { widgets = JSON.parse(formJson || '[]'); } catch { return []; }
  if (!Array.isArray(widgets)) return [];
  const val = (w) => {
    const v = w.value;
    if (v === null || v === undefined || v === '') return '';
    if (['attachmentV2', 'attachment', 'image', 'imageV2'].includes(w.type)) return Array.isArray(v) ? `[${v.length} tệp]` : '[tệp]';
    if (w.type === 'dateInterval' && typeof v === 'object') return `${v.start ?? ''} → ${v.end ?? ''}${v.interval ? ` (${v.interval})` : ''}`;
    if (w.type === 'fieldList' && Array.isArray(v)) return v.map((row, i) => `\n    • dòng ${i + 1}: ` + (Array.isArray(row) ? row.map((c) => `${c.name}: ${typeof c.value === 'object' ? JSON.stringify(c.value) : c.value}`).join('; ') : JSON.stringify(row))).join('');
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? (x.name ?? x.text ?? JSON.stringify(x)) : String(x))).join(', ');
    if (typeof v === 'object') return short(JSON.stringify(v), 300);
    return String(v);
  };
  return widgets.filter((w) => w && w.name).map((w) => `${w.name}: ${short(val(w), 500) || '(trống)'}`);
}

export class LarkManager extends EventEmitter {
  constructor({ db, log, integrations, file }) {
    super();
    this.db = db; this.log = log; this.integrations = integrations; this.file = file;
    this.state = this.load();
    this.timer = null; this.syncing = false; this.lastError = null; this.lastResult = null; this.nextRunAt = null;
    this.token = null; this.tokenExp = 0; this.names = new Map();
  }
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { instances: {}, lastSyncAt: null }; } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 }); }
  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }

  status() {
    const cfg = this.integrations.view('lark');
    const inst = Object.values(this.state.instances ?? {});
    return { enabled: !!cfg.enabled, configured: !!cfg.configured, domain: cfg.domain, approvalCodes: cfg.approvalCodes?.length ?? 0, days: cfg.days,
      syncing: this.syncing, lastSyncAt: this.state.lastSyncAt, lastResult: this.lastResult, lastError: this.lastError, nextRunAt: this.nextRunAt, everyMinutes: SYNC_MINUTES,
      tracked: inst.length, pending: inst.filter((i) => i.status === 'PENDING').length };
  }
  schedule() {
    this.stop();
    const cfg = this.integrations.view('lark');
    if (!cfg.enabled || !cfg.configured) { this.emitChange(); return; }
    this.nextRunAt = Date.now() + 8000;
    this.timer = setTimeout(() => { void this.sync('tự động'); this.timer = setInterval(() => { void this.sync('tự động'); }, SYNC_MINUTES * 60e3); this.nextRunAt = Date.now() + SYNC_MINUTES * 60e3; }, 8000);
    this.emitChange();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; this.nextRunAt = null; }

  async api(cfg, method, p, { query, body } = {}) {
    const base = larkBase(cfg.domain);
    if (!this.token || Date.now() > this.tokenExp) {
      const r = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }), signal: AbortSignal.timeout(20000) }).then((x) => x.json());
      if (r.code !== 0) throw new Error(`Lark không cấp token (${r.code}): ${r.msg}`);
      this.token = r.tenant_access_token; this.tokenExp = Date.now() + Math.max(60, (r.expire ?? 7200) - 120) * 1000;
    }
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await fetch(`${base}${p}${qs}`, { method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (j.code !== 0) throw Object.assign(new Error(`Lark ${p} trả mã ${j.code ?? res.status}: ${j.msg ?? 'không rõ'}`), { larkCode: j.code });
    return j.data ?? {};
  }
  async userName(cfg, openId) {
    if (!openId) return 'Hệ thống';
    if (this.names.has(openId)) return this.names.get(openId);
    let name = `Người dùng ${String(openId).slice(-6)}`;
    try { const d = await this.api(cfg, 'GET', `/open-apis/contact/v3/users/${encodeURIComponent(openId)}`, { query: { user_id_type: 'open_id' } }); name = d.user?.name || name; }
    catch { /* thiếu quyền contact ⇒ dùng mã rút gọn */ }
    this.names.set(openId, name); return name;
  }

  /** Liệt kê phiếu trong khoảng thời gian (theo từng approval_code, hoặc mọi quy trình khi danh sách trống). */
  async listInstances(cfg, fromMs, toMs) {
    const codes = cfg.approvalCodes?.length ? cfg.approvalCodes : [null];
    const out = [];
    for (const code of codes) {
      let pageToken = ''; let guard = 0;
      do {
        const body = { instance_start_time_from: String(fromMs), instance_start_time_to: String(toMs) };
        if (code) body.approval_code = code;
        const d = await this.api(cfg, 'POST', '/open-apis/approval/v4/instances/query', { query: { page_size: '100', user_id_type: 'open_id', ...(pageToken ? { page_token: pageToken } : {}) }, body });
        for (const it of d.instance_list ?? []) out.push({ approvalName: it.approval?.name, approvalCode: it.approval?.code, code: it.instance?.code, status: it.instance?.status, title: it.instance?.title, serial: it.instance?.serial_id, userId: it.instance?.user_id, startTime: Number(it.instance?.start_time ?? 0), link: it.instance?.link?.pc_link });
        pageToken = d.has_more ? d.page_token : ''; guard++;
      } while (pageToken && guard < 20);
      await sleep(200);
    }
    return out;
  }

  async sync(reason = 'tay') {
    if (this.syncing) return this.status();
    const cfg = this.integrations.secrets('lark');
    if (!cfg.appId || !cfg.appSecret) { this.lastError = 'Chưa có App ID / App Secret.'; this.emitChange(); return this.status(); }
    this.syncing = true; this.lastError = null; this.emitChange();
    const t0 = Date.now(); let fetched = 0, inserted = 0, updated = 0;
    try {
      const accountId = LARK_PREFIX + cfg.appId;
      this.db.upsertAccount({ id: accountId, displayName: 'Lark Approval', avatarUrl: null, phone: null, status: 'connected' });
      const now = Date.now();
      const list = await this.listInstances(cfg, now - (cfg.days || 7) * 86400e3, now);
      // Phiếu đã biết còn chờ duyệt nhưng rơi ngoài khoảng ngày ⇒ vẫn xem lại để bắt kết quả duyệt.
      const known = this.state.instances ?? (this.state.instances = {});
      const codes = new Map(list.map((i) => [i.code, i]));
      for (const [code, k] of Object.entries(known)) if (k.status === 'PENDING' && !codes.has(code)) codes.set(code, { code, status: 'PENDING', approvalName: k.approvalName, title: k.title, serial: k.serial });
      for (const meta of codes.values()) {
        const k = known[meta.code];
        if (k && k.status === meta.status && k.status !== 'PENDING' && k.done) continue;   // đã lấy đủ, không đổi
        let d;
        try { d = await this.api(cfg, 'GET', `/open-apis/approval/v4/instances/${encodeURIComponent(meta.code)}`, { query: { user_id_type: 'open_id' } }); }
        catch (err) { this.log?.warn(`Lark: không đọc được phiếu ${meta.code}: ${err?.message ?? err}`); continue; }
        fetched++;
        const rows = await this.rowsOf({ cfg, accountId, meta, d });
        let n = 0; for (const row of rows) if (this.db.insertMessage(row)) n++;
        inserted += n;
        const statusNow = d.status || meta.status;
        const name = this.convName(meta, d, statusNow);
        this.db.updateConversationMeta(accountId, LARK_PREFIX + meta.code, { name });
        if (k && k.status !== statusNow) updated++;
        known[meta.code] = { status: statusNow, approvalName: d.approval_name || meta.approvalName, title: meta.title || '', serial: d.serial_number || meta.serial || '', timeline: (d.timeline ?? []).length, done: statusNow !== 'PENDING', updatedAt: Date.now() };
        await sleep(150);
      }
      this.state.lastSyncAt = Date.now(); this.save();
      this.lastResult = { listed: codes.size, fetched, inserted, updated, at: Date.now(), ms: Date.now() - t0 };
      if (inserted) this.emit('message', { source: 'old_sync', count: inserted });
      this.log?.info(`Lark (${reason}): ${codes.size} phiếu, đọc ${fetched}, thêm ${inserted} bước mới, ${updated} phiếu đổi trạng thái (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
    } catch (err) {
      this.lastError = String(err?.message ?? err).slice(0, 300);
      if (err?.larkCode === 99991663 || err?.larkCode === 99991672) this.lastError += ' — ứng dụng Lark chưa được cấp quyền Approval (approval:approval:readonly, approval:instance:readonly) hoặc chưa phát hành.';
      this.log?.error(`Lark (${reason}) lỗi: ${err?.message ?? err}`);
    } finally { this.syncing = false; this.emitChange(); }
    return this.status();
  }

  convName(meta, d, status) {
    const t = meta.title || d.serial_number || meta.serial || meta.code;
    return `📋 [${STATUS_VI[status] ?? status}] ${d.approval_name || meta.approvalName || 'Phiếu duyệt'} · ${short(t, 80)}`;
  }

  /** Mỗi mục dòng thời gian (nộp, duyệt, từ chối, bình luận, chuyển…) = một tin; tin "nộp phiếu" mang nội dung biểu mẫu. */
  async rowsOf({ cfg, accountId, meta, d }) {
    const threadId = LARK_PREFIX + meta.code;
    const status = d.status || meta.status;
    const formLines = renderForm(d.form);
    const myId = cfg.userId || null;
    const pendingTasks = (d.task_list ?? []).filter((t) => t.status === 'PENDING');
    const timeline = [...(d.timeline ?? [])].sort((a, b) => Number(a.create_time) - Number(b.create_time));
    const comments = (d.comment_list ?? []).map((c) => ({ type: 'COMMENT', create_time: c.create_time, open_id: c.open_id, user_id: c.user_id, comment: c.comment, id: c.id }));
    const items = [...timeline, ...comments].sort((a, b) => Number(a.create_time) - Number(b.create_time));
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const ev = items[i];
      const who = await this.userName(cfg, ev.open_id || ev.user_id);
      const isMe = !!myId && (ev.open_id === myId || ev.user_id === myId);
      const parts = [];
      if (ev.type === 'START') {
        parts.push(`${who} nộp phiếu "${d.approval_name || meta.approvalName || ''}"${d.serial_number ? ` (số ${d.serial_number})` : ''}${meta.title ? ` — ${meta.title}` : ''}.`);
        if (formLines.length) parts.push('Nội dung phiếu:\n  ' + formLines.join('\n  '));
      } else {
        parts.push(`${who} ${TL_VI[ev.type] ?? String(ev.type ?? '').toLowerCase()}${ev.node_key || ev.node_name ? ` (bước ${ev.node_name || ev.node_key})` : ''}.`);
        if (ev.comment) parts.push(`Ý kiến: ${short(ev.comment, 1000)}`);
        if (Array.isArray(ev.user_id_list) && ev.user_id_list.length) parts.push(`Liên quan: ${ev.user_id_list.length} người.`);
      }
      const last = i === items.length - 1;
      if (last) {
        if (status === 'PENDING' && pendingTasks.length) {
          const names = []; for (const t of pendingTasks.slice(0, 5)) names.push(`${await this.userName(cfg, t.open_id || t.user_id)}${t.node_name ? ` (${t.node_name})` : ''}`);
          const mine = !!myId && pendingTasks.some((t) => t.open_id === myId || t.user_id === myId);
          parts.push(`Trạng thái hiện tại: CHỜ DUYỆT — đang chờ ${names.join(', ')}${mine ? '. ⚠️ Phiếu này đang chờ BẠN duyệt.' : '.'}`);
        } else parts.push(`Trạng thái hiện tại: ${STATUS_VI[status] ?? status}.`);
      }
      const text = parts.join('\n');
      rows.push({
        account_id: accountId, thread_id: threadId, is_group: 1,
        // Mã tin ổn định theo mục dòng thời gian; mục cuối có kèm trạng thái nên đổi mã theo trạng thái để cập nhật khi phiếu chuyển bước.
        zalo_msg_id: `${meta.code}:${i}:${ev.type}:${ev.create_time}${last ? `:${status}:${pendingTasks.length}` : ''}`, cli_msg_id: null, is_outbound: isMe ? 1 : 0,
        sender_id: ev.open_id || ev.user_id || null, sender_name: who,
        type: 'text', text, attachments_json: null, quote_text: null,
        event_time: Number(ev.create_time) || Date.now(), source: 'history', recalled: 0,
        raw_json: JSON.stringify({ instance: meta.code, type: ev.type, status, approvalCode: d.approval_code || meta.approvalCode, link: meta.link ?? null }),
        created_at: Date.now(), conv_name: this.convName(meta, d, status), conv_avatar: null, conv_phone: null,
        preview: previewOf({ type: 'text', text: text.split('\n')[0] }),
      });
    }
    return rows;
  }
}
