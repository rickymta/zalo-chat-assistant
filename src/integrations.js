/**
 * Khoá cấu hình các nguồn/kênh chưa có bộ quản lý riêng: Email IMAP (bước 3), Lark Approval (bước 4), bot Telegram gửi bản tin (bước 5).
 * Lưu ở data/integrations.json (quyền 600); trường bí mật (mật khẩu, app secret, bot token) mã hoá bằng chuỗi mã hoá của tài khoản
 * khi đã mở khoá. API trả bản CHE bí mật (chỉ báo đã có hay chưa); lưu với chuỗi rỗng = giữ bí mật cũ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isEncrypted } from './crypto/cipher.js';

const SECRET_FIELDS = { email: ['password'], lark: ['appSecret'], digest: ['botToken'] };
const DEFAULTS = {
  email: { enabled: false, host: '', port: 993, secure: true, user: '', password: '', folder: 'INBOX', days: 7 },
  lark: { enabled: false, domain: 'larksuite', appId: '', appSecret: '', approvalCodes: [], days: 7, userId: '' },
  digest: { enabled: false, botToken: '', chatId: '', voice: 'google:vi-bac', times: ['07:30', '17:30'], sendText: true },
};
export const KINDS = Object.keys(DEFAULTS);

export class IntegrationStore {
  constructor({ file, getCipher, log }) {
    this.file = file; this.getCipher = getCipher; this.log = log;
    this.data = this.load();
    this.lastTest = {};
  }
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.file, 0o600); } catch { /* bỏ qua */ }
  }
  enc(v) { const c = this.getCipher?.(); return v ? (c?.ready ? c.encrypt(String(v)) : String(v)) : ''; }
  dec(v) { if (!v) return ''; if (!isEncrypted(v)) return String(v); const c = this.getCipher?.(); try { return c?.ready ? c.decrypt(v) : ''; } catch { return ''; } }

  /** Bản đầy đủ (đã giải mã) — chỉ dùng nội bộ (kết nối IMAP, gọi Lark, gửi bot). */
  secrets(kind) {
    const d = { ...DEFAULTS[kind], ...(this.data[kind] ?? {}) };
    for (const f of SECRET_FIELDS[kind] ?? []) d[f] = this.dec(d[f]);
    return d;
  }
  /** Bản cho giao diện: bí mật thay bằng cờ has<Field>. */
  view(kind) {
    const d = this.secrets(kind);
    if (kind === 'digest' && d.botToken) d.botTokenHint = tokenHint(d.botToken);
    for (const f of SECRET_FIELDS[kind] ?? []) { d[`has${f[0].toUpperCase()}${f.slice(1)}`] = !!d[f]; delete d[f]; }
    d.configured = this.isConfigured(kind, this.secrets(kind));
    d.lastTest = this.lastTest[kind] ?? null;
    return d;
  }
  viewAll() { const o = {}; for (const k of KINDS) o[k] = this.view(k); return o; }
  isConfigured(kind, d) {
    if (kind === 'email') return !!(d.user && d.password);
    if (kind === 'lark') return !!(d.appId && d.appSecret);
    if (kind === 'digest') return !!(d.botToken && d.chatId);
    return false;
  }

  set(kind, patch = {}) {
    this.data[kind] = this.buildNext(kind, patch); this.save();
    this.onChange?.(kind);
    return this.view(kind);
  }
  /** Dựng bản cấu hình mới từ bản đã lưu + thay đổi (xác thực đầu vào, mã hoá bí mật) — KHÔNG ghi đĩa. */
  buildNext(kind, patch = {}) {
    if (!KINDS.includes(kind)) throw Object.assign(new Error('Loại cấu hình không hợp lệ.'), { status: 400 });
    const cur = { ...DEFAULTS[kind], ...(this.data[kind] ?? {}) };
    const next = { ...cur };
    const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
    if (kind === 'email') {
      if (patch.host !== undefined) next.host = str(patch.host, 200);
      if (patch.port !== undefined) { const p = Number(patch.port); if (!Number.isInteger(p) || p < 1 || p > 65535) throw Object.assign(new Error('Cổng IMAP không hợp lệ.'), { status: 400 }); next.port = p; }
      if (patch.secure !== undefined) next.secure = !!patch.secure;
      if (patch.user !== undefined) next.user = str(patch.user, 200);
      if (patch.folder !== undefined) next.folder = str(patch.folder, 200) || 'INBOX';
      if (patch.days !== undefined) next.days = Math.min(Math.max(Math.round(Number(patch.days) || 7), 1), 60);
      if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
      if (typeof patch.password === 'string' && patch.password) next.password = this.enc(patch.password);
    } else if (kind === 'lark') {
      if (patch.domain !== undefined) { if (!['larksuite', 'feishu'].includes(patch.domain)) throw Object.assign(new Error('Domain Lark phải là larksuite hoặc feishu.'), { status: 400 }); next.domain = patch.domain; }
      if (patch.appId !== undefined) next.appId = str(patch.appId, 100);
      if (patch.approvalCodes !== undefined) next.approvalCodes = (Array.isArray(patch.approvalCodes) ? patch.approvalCodes : String(patch.approvalCodes).split(/[\n,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
      if (patch.days !== undefined) next.days = Math.min(Math.max(Math.round(Number(patch.days) || 7), 1), 60);
      if (patch.userId !== undefined) next.userId = str(patch.userId, 100);   // open_id của chính người dùng để đánh dấu "chờ BẠN duyệt" (tuỳ chọn)
      if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
      if (typeof patch.appSecret === 'string' && patch.appSecret) next.appSecret = this.enc(patch.appSecret);
    } else if (kind === 'digest') {
      if (patch.chatId !== undefined) next.chatId = str(patch.chatId, 64);
      if (patch.voice !== undefined) next.voice = str(patch.voice, 64) || 'google:vi-bac';
      if (patch.times !== undefined) {
        const t = (Array.isArray(patch.times) ? patch.times : String(patch.times).split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
        for (const x of t) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) throw Object.assign(new Error(`Giờ bản tin "${x}" không hợp lệ (dạng HH:MM).`), { status: 400 });
        next.times = [...new Set(t)].sort().slice(0, 6);
      }
      if (patch.sendText !== undefined) next.sendText = !!patch.sendText;
      if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
      if (typeof patch.botToken === 'string' && patch.botToken) {
        if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(patch.botToken.trim())) throw Object.assign(new Error('Bot token không đúng dạng (số:chuỗi, lấy từ @BotFather).'), { status: 400 });
        next.botToken = this.enc(patch.botToken.trim());
      }
    }
    return next;
  }
  /** Giải mã bí mật của một bản cấu hình (đã lưu hoặc ứng viên). */
  decrypted(kind, raw) { const d = { ...DEFAULTS[kind], ...raw }; for (const f of SECRET_FIELDS[kind] ?? []) d[f] = this.dec(d[f]); return d; }

  /**
   * Kiểm tra kết nối. Có `patch` (giá trị đang gõ trên biểu mẫu) thì kiểm bằng ứng viên = bản đã lưu + patch (ô bí mật để trống
   * = dùng bí mật đã lưu); kết nối ĐƯỢC mới ghi đĩa ("kiểm tra trước, lưu sau"), hỏng thì bản đã lưu giữ nguyên.
   * Không có `patch` thì kiểm bằng bản đã lưu. Không đổi trạng thái gì ở phía dịch vụ (trừ gửi tin thử bot khi được yêu cầu). */
  async test(kind, { sendTest = false, patch = null } = {}) {
    const next = patch ? this.buildNext(kind, patch) : (this.data[kind] ?? {});
    const d = this.decrypted(kind, next);
    const t0 = Date.now();
    let result;
    try {
      if (kind === 'email') result = await testImap(d);
      else if (kind === 'lark') result = await testLark(d);
      else if (kind === 'digest') result = await testBot(d, sendTest);
      else throw new Error('Loại cấu hình không hợp lệ.');
      const { apply, ...rest } = result ?? {};
      result = { ok: true, ...rest, saved: !!patch || !!apply };
      if (apply) Object.assign(next, apply);          // máy chủ IMAP dò được ⇒ ghi lại để các lần sau không dò nữa
      if (patch || apply) { this.data[kind] = next; this.save(); this.onChange?.(kind); }
    } catch (err) {
      result = { ok: false, error: friendlyError(err) };
    }
    result.at = Date.now(); result.ms = Date.now() - t0;
    this.lastTest[kind] = result;
    this.log?.info(`Kiểm tra ${kind}: ${result.ok ? 'OK' : 'lỗi'}${result.error ? ` — ${result.error}` : ''} (${result.ms} ms)`);
    return { ...this.view(kind), lastTest: result };
  }
}

/** Dạng che của bot token để người dùng đối chiếu với BotFather mà không lộ token: `<id bot>:AAH…k2Q (35 ký tự sau dấu hai chấm)`. */
export function tokenHint(token) {
  const i = String(token).indexOf(':'); if (i < 0) return '';
  const id = token.slice(0, i), secret = token.slice(i + 1);
  return `${id}:${secret.slice(0, 3)}…${secret.slice(-3)} (${secret.length} ký tự sau dấu hai chấm)`;
}

export function friendlyError(err) {
  const m = String(err?.message ?? err);
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Không tìm thấy máy chủ (sai host hoặc chưa có mạng).';
  if (/ECONNREFUSED/.test(m)) return 'Máy chủ từ chối kết nối (sai cổng hoặc chưa mở IMAP).';
  if (/ETIMEDOUT|timeout/i.test(m)) return 'Hết thời gian chờ kết nối.';
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication/i.test(m)) return 'Sai tài khoản hoặc mật khẩu (Gmail/Outlook cần mật khẩu ứng dụng).';
  return m.slice(0, 300);
}

async function testImap(d) {
  if (!d.user || !d.password) throw new Error('Cần địa chỉ email và mật khẩu.');
  const { ImapFlow } = await import('imapflow');
  const { connectImap } = await import('./mail/discover.js');
  const { client, applied, changed, discovered, note } = await connectImap(ImapFlow, d);
  try {
    const lock = await client.getMailboxLock(d.folder || 'INBOX');
    try { return { mailbox: client.mailbox?.path, messages: client.mailbox?.exists ?? null, ...(changed ? { apply: applied } : {}), discovered, note }; } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}

export function larkBase(domain) { return domain === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com'; }
async function testLark(d) {
  if (!d.appId || !d.appSecret) throw new Error('Chưa có App ID / App Secret.');
  const res = await fetch(`${larkBase(d.domain)}/open-apis/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: d.appId, app_secret: d.appSecret }), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (j.code !== 0) throw new Error(`Lark trả mã ${j.code ?? res.status}: ${j.msg ?? 'không rõ'}`);
  return { expiresIn: j.expire, approvalCodes: d.approvalCodes.length };
}

async function testBot(d, sendTest) {
  if (!d.botToken) throw new Error('Chưa có bot token.');
  const base = `https://api.telegram.org/bot${d.botToken}`;
  const me = await fetch(`${base}/getMe`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch((e) => { throw new Error(`Không gọi được Telegram: ${e?.message ?? e}`); });
  if (!me.ok) {
    if (me.error_code === 401) throw new Error(`Telegram không nhận token này (401). Đang lưu: ${tokenHint(d.botToken)} — so với BotFather (/mybots → API Token, thường 35 ký tự sau dấu hai chấm): sao chép thiếu/dư một ký tự hay đã /revoke đều gây 401. Dán lại token rồi bấm Kiểm tra bot.`);
    throw new Error(`Telegram từ chối token (${me.error_code}): ${me.description}`);
  }
  const out = { bot: me.result?.username ? `@${me.result.username}` : me.result?.first_name, sent: false };
  if (sendTest) {
    if (!d.chatId) throw new Error('Chưa có chat ID để gửi tin thử.');
    const r = await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: d.chatId, text: '✅ Work Assistant đã kết nối bot bản tin. Bản tin giọng nói sẽ được gửi vào đây theo lịch.' }), signal: AbortSignal.timeout(15000) }).then((x) => x.json());
    if (!r.ok) throw new Error(`Gửi tin thử thất bại (${r.error_code}): ${r.description} — kiểm tra chat ID và đã bấm Start với bot chưa.`);
    out.sent = true;
  }
  return out;
}
