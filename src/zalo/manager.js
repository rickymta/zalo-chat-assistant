/**
 * Quản lý phiên Zalo cá nhân: đăng nhập QR, khôi phục phiên đã lưu, nghe tin realtime, ghi vào SQLite.
 *
 * ⚠️ ĐỌC TRƯỚC KHI SỬA (cùng cảnh báo với zalo-personal-bridge của CRM):
 *  - Zalo KHÔNG có API chính thức cho tài khoản cá nhân. `zca-js` mô phỏng phiên Zalo Web ⇒ tài khoản CÓ THỂ
 *    bị khoá. Dùng số công ty cấp; đừng đăng nhập/đăng xuất liên tục; không chạy nhiều máy cùng một số.
 *  - Một tài khoản chỉ chạy được MỘT phiên web: mở chat.zalo.me trên trình duyệt là phiên ở đây rớt
 *    (Zalo trên ĐIỆN THOẠI thì không sao). Ứng dụng này CHỈ ĐỌC — không gửi tin, không đánh dấu đã xem —
 *    để giảm rủi ro tối đa.
 *  - `selfListen: true` là bắt buộc: không có nó, tin CHÍNH MÌNH gửi từ điện thoại bị vứt trước khi tới
 *    callback ⇒ lịch sử chỉ còn một nửa cuộc trò chuyện.
 *  - Callback do zca-js gọi KHÔNG ai await ⇒ mọi thân callback phải try/catch, nếu không một lỗi lẻ giết cả
 *    tiến trình (sự cố thật ở CRM 23/08/2026).
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Zalo, ThreadType } from 'zca-js';
import QRCode from 'qrcode';
import { normalizeMessage, previewOf } from './normalize.js';
import { ProfileResolver } from './profiles.js';

const ZALO_OPTIONS = { selfListen: true, checkUpdate: false, logging: false };
const PNG_BASE64_PREFIX = 'iVBORw0KGgo';
const QR_TTL_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `event.data.image` của zca-js là PNG base64 TRẦN — bọc tiền tố là đủ; chuỗi ngắn mới là payload QR thật. */
async function toQrDataUri(raw) {
  const s = String(raw ?? '');
  if (!s) return null;
  if (s.startsWith('data:')) return s;
  if (s.startsWith(PNG_BASE64_PREFIX)) return `data:image/png;base64,${s}`;
  if (s.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return `data:image/png;base64,${s}`;
  return QRCode.toDataURL(s);
}

function publicQr(p) {
  return {
    state: p.state,
    qrImage: p.qrImage ?? null,
    scannedName: p.scannedName ?? null,
    scannedAvatar: p.scannedAvatar ?? null,
    accountId: p.accountId ?? null,
    error: p.error ?? null,
  };
}

export class ZaloManager extends EventEmitter {
  /**
   * @param {{ db: any, log: any, sessionsDir: string, getSettings: () => any }} deps
   */
  constructor({ db, log, sessionsDir, getSettings }) {
    super();
    this.db = db;
    this.log = log;
    this.sessionsDir = sessionsDir;
    this.getSettings = getSettings;
    this.live = new Map();      // accountId → { api, startedAt }
    this.qr = new Map();        // key → trạng thái đăng nhập QR đang chờ
    this.profiles = new ProfileResolver(log);
  }

  // ── Phiên đã lưu ──────────────────────────────────────────────────────────────

  sessionFile(id) { return path.join(this.sessionsDir, `${id}.json`); }

  readSession(id) {
    try { return JSON.parse(fs.readFileSync(this.sessionFile(id), 'utf8')); } catch { return null; }
  }

  writeSession(id, data) {
    const file = this.sessionFile(id);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* bỏ qua */ }
  }

  listSavedSessionIds() {
    try {
      return fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    } catch { return []; }
  }

  /** Khôi phục MỌI phiên đã lưu — tuần tự, không Promise.all (đăng nhập ồ ạt từ một IP là tín hiệu xấu). */
  async restoreAll() {
    const ids = this.listSavedSessionIds();
    if (!ids.length) { this.log.info('Chưa có phiên Zalo nào được lưu — bấm "Đăng nhập QR" trên giao diện.'); return; }
    this.log.info(`Khôi phục ${ids.length} phiên Zalo đã lưu…`);
    for (const id of ids) {
      await this.start(id);
      await sleep(1500);
    }
  }

  async start(id) {
    const s = this.readSession(id);
    if (!s?.cookie) return { ok: false, error: 'Chưa có phiên đã lưu — cần quét QR.' };
    if (this.live.has(id)) return { ok: true };

    this.setStatus(id, 'connecting');
    try {
      const zalo = new Zalo(ZALO_OPTIONS);
      const api = await zalo.login({ cookie: s.cookie, imei: s.imei ?? '', userAgent: s.userAgent ?? '' });
      await this.onLoggedIn(api, 'restore');
      this.log.info(`Đã khôi phục phiên ${s.displayName ?? id}.`);
      return { ok: true };
    } catch (err) {
      const message = err?.message ?? String(err);
      this.log.error(`Khôi phục phiên ${id} thất bại: ${message}`);
      this.setStatus(id, 'need_relogin', message);
      return { ok: false, error: message };
    }
  }

  // ── Đăng nhập QR ──────────────────────────────────────────────────────────────

  async startQrLogin() {
    // Chỉ một luồng QR tại một thời điểm — huỷ luồng cũ còn treo.
    for (const [k, p] of this.qr) {
      if (p.state === 'pending' || p.state === 'scanned') { try { p.abort?.(); } catch { /* bỏ qua */ } p.state = 'expired'; }
      if (Date.now() - p.createdAt > 4 * QR_TTL_MS) this.qr.delete(k);
    }

    const key = `qr-${Date.now()}`;
    const pending = { state: 'pending', createdAt: Date.now() };
    this.qr.set(key, pending);

    const zalo = new Zalo(ZALO_OPTIONS);
    const loginPromise = zalo.loginQR({}, async (event) => {
      try {
        switch (event?.type) {
          case 0: { // QR đã sinh
            pending.qrImage = await toQrDataUri(event.data?.image ?? event.data?.code);
            pending.state = 'pending';
            pending.retry = event.actions?.retry;
            pending.abort = event.actions?.abort;
            break;
          }
          case 1: pending.state = 'expired'; break;
          case 2: { // đã quét, chờ xác nhận trên điện thoại
            pending.state = 'scanned';
            pending.scannedName = event.data?.display_name ?? null;
            pending.scannedAvatar = event.data?.avatar ?? null;
            break;
          }
          case 3: pending.state = 'declined'; break;
          default: break; // 4 = đã có thông tin đăng nhập, promise sắp resolve
        }
        this.emit('qr', { key, ...publicQr(pending) });
      } catch (err) {
        pending.state = 'failed';
        pending.error = err?.message ?? String(err);
        this.log.error(`Lỗi xử lý sự kiện QR: ${pending.error}`);
      }
    });

    loginPromise
      .then(async (api) => {
        const account = await this.onLoggedIn(api, 'qr');
        pending.state = 'success';
        pending.accountId = account.id;
        this.emit('qr', { key, ...publicQr(pending) });
        this.log.info(`Đăng nhập QR thành công: ${account.displayName ?? account.id}.`);
      })
      .catch((err) => {
        if (pending.state !== 'expired' && pending.state !== 'declined') pending.state = 'failed';
        pending.error = err?.message ?? String(err);
        this.emit('qr', { key, ...publicQr(pending) });
        this.log.error(`Đăng nhập QR thất bại: ${pending.error}`);
      });

    // Chờ ngắn để callback kịp sinh ảnh — không chờ thì lần poll đầu luôn rỗng.
    for (let i = 0; i < 10 && !pending.qrImage && pending.state === 'pending'; i++) await sleep(300);
    return { key, ...publicQr(pending) };
  }

  getQrStatus(key) {
    const p = this.qr.get(key);
    if (!p) return { state: 'expired' };
    if (p.state === 'pending' && Date.now() - p.createdAt > QR_TTL_MS) p.state = 'expired';
    return publicQr(p);
  }

  // ── Sau khi có API ────────────────────────────────────────────────────────────

  async onLoggedIn(api, source) {
    const ctx = api?.getContext?.() ?? {};
    let uid = null;
    try { uid = String(api.getOwnId?.() ?? ctx.uid ?? ''); } catch { uid = String(ctx.uid ?? ''); }
    if (!uid) throw new Error('Không lấy được uid của tài khoản sau khi đăng nhập.');

    // `ctx.cookie` là CookieJar của tough-cookie — JSON.stringify thẳng ra object rỗng, phải toJSON().
    const cookie = typeof ctx.cookie?.toJSON === 'function' ? ctx.cookie.toJSON() : ctx.cookie;

    let profile = {};
    try { profile = (await api.fetchAccountInfo())?.profile ?? {}; } catch (err) {
      this.log.warn(`Không đọc được hồ sơ tài khoản: ${err?.message ?? err}`);
    }
    const account = {
      id: uid,
      displayName: profile.displayName ?? profile.zaloName ?? this.readSession(uid)?.displayName ?? null,
      avatarUrl: profile.avatar ?? null,
      phone: profile.phoneNumber ?? null,
    };

    this.writeSession(uid, {
      uid,
      cookie,
      imei: ctx.imei ?? '',
      userAgent: ctx.userAgent ?? '',
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      phone: account.phone,
      savedAt: Date.now(),
      source,
    });
    this.db.upsertAccount({ ...account, status: 'connected' });
    this.attach(uid, api);
    this.emit('status', { accountId: uid, status: 'connected' });
    return account;
  }

  setStatus(id, status, error = null) {
    if (this.db.getAccount(id)) this.db.setAccountStatus(id, status, error);
    this.emit('status', { accountId: id, status, error });
  }

  attach(id, api) {
    this.stop(id, { silent: true });
    this.live.set(id, { api, startedAt: Date.now() });
    const l = api.listener;

    l.on('message', (msg) => { void this.ingest(id, msg, 'live'); });

    l.on('old_messages', (msgs, type) => {
      const list = Array.isArray(msgs) ? msgs : [];
      this.log.info(`Zalo trả về ${list.length} tin bỏ lỡ (${type === ThreadType.Group ? 'nhóm' : '1-1'}).`);
      void (async () => { for (const m of list) await this.ingest(id, m, 'old_sync'); })();
    });

    l.on('undo', (u) => {
      try {
        const c = u?.data?.content ?? {};
        const n = this.db.markRecalled(id, String(c.globalMsgId ?? ''), String(c.cliMsgId ?? ''));
        if (n) this.emit('message', { accountId: id, threadId: String(u?.threadId ?? ''), recalled: true });
      } catch (err) { this.log.warn(`Không đánh dấu được tin thu hồi: ${err?.message ?? err}`); }
    });

    l.on('connected', () => {
      this.log.info(`Listener ${id} đã kết nối.`);
      this.setStatus(id, 'connected');
      if (this.getSettings().syncOldOnConnect) setTimeout(() => this.requestOld(id), 2500);
    });

    // zca-js tự nối lại với retryOnClose — 'disconnected' chỉ là tạm thời; 'closed' mới là chết hẳn.
    l.on('disconnected', (code, reason) => {
      this.log.warn(`Listener ${id} mất kết nối (${code}) ${reason ?? ''} — đang thử nối lại.`);
      this.setStatus(id, 'reconnecting', String(reason ?? code ?? ''));
    });
    l.on('closed', (code, reason) => {
      const msg = `Phiên đóng (${code}) ${reason ?? ''}`.trim();
      this.log.warn(`Listener ${id}: ${msg}`);
      this.live.delete(id);
      // 1000 = tự mình dừng; 3000/3003 = bị đá vì có phiên web khác hoặc cookie hết hạn ⇒ cần quét lại.
      this.setStatus(id, code === 1000 ? 'disconnected' : 'need_relogin', code === 1000 ? null : msg);
    });
    l.on('error', (err) => {
      this.log.error(`Listener ${id} lỗi (phiên vẫn giữ): ${err?.message ?? err}`);
    });

    try {
      l.start({ retryOnClose: true });
    } catch (err) {
      this.log.error(`Không khởi động được listener ${id}: ${err?.message ?? err}`);
      this.live.delete(id);
      this.setStatus(id, 'need_relogin', err?.message ?? String(err));
    }
  }

  /** Xin Zalo gửi lại phần tin đã bỏ lỡ (cơ chế "offline sync" của Zalo Web — độ sâu do máy chủ Zalo quyết). */
  requestOld(id) {
    const live = this.live.get(id);
    if (!live) return { ok: false, error: 'Tài khoản chưa kết nối.' };
    const acc = this.db.getAccount(id);
    try {
      live.api.listener.requestOldMessages(ThreadType.User, acc?.last_user_msg_id ?? null);
      if (this.getSettings().includeGroups) {
        setTimeout(() => {
          try { live.api.listener.requestOldMessages(ThreadType.Group, acc?.last_group_msg_id ?? null); } catch { /* bỏ qua */ }
        }, 1500);
      }
      this.log.info(`Đã yêu cầu Zalo gửi tin bỏ lỡ cho ${id}.`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  async syncContacts(id) {
    const live = this.live.get(id);
    if (!live) return { ok: false, error: 'Tài khoản chưa kết nối.' };
    try {
      const friends = await live.api.getAllFriends();
      const list = Array.isArray(friends) ? friends : [];
      this.db.upsertContacts(id, list);
      for (const f of list) {
        this.profiles.primeUser(String(f.userId), {
          name: f.displayName ?? f.zaloName ?? null, avatar: f.avatar ?? null, phone: f.phoneNumber ?? null,
        });
      }
      this.log.info(`Đồng bộ danh bạ ${id}: ${list.length} bạn bè.`);
      return { ok: true, count: list.length };
    } catch (err) {
      const message = err?.message ?? String(err);
      this.log.error(`Đồng bộ danh bạ ${id} thất bại: ${message}`);
      return { ok: false, error: message };
    }
  }

  // ── Ghi tin ───────────────────────────────────────────────────────────────────

  async ingest(id, msg, source) {
    try {
      const n = normalizeMessage(msg);
      if (!n) return;
      const settings = this.getSettings();
      if (n.isGroup && !settings.includeGroups) return;

      const api = this.live.get(id)?.api;
      const account = this.db.getAccount(id);
      const existing = this.db.getConversation(id, n.threadId);

      // Tên hội thoại: tin ĐẾN của 1-1 mang tên người gửi = tên hội thoại; tin ĐI thì dName là mình.
      let convName = !n.isGroup && !n.isOutbound ? n.senderName : null;
      let convAvatar = null;
      let convPhone = null;

      const needProfile = !existing || !existing.name || (!existing.phone && !n.isGroup && !existing.avatar_url);
      if (needProfile && api) {
        const p = n.isGroup ? await this.profiles.group(api, n.threadId) : await this.profiles.user(api, n.threadId);
        convName = convName ?? p.name ?? null;
        convAvatar = p.avatar ?? null;
        convPhone = p.phone ?? null;
      }
      if (!convName && !n.isGroup) {
        const c = this.db.getContact(id, n.threadId);
        if (c) { convName = c.display_name ?? c.zalo_name ?? null; convPhone = convPhone ?? c.phone; convAvatar = convAvatar ?? c.avatar_url; }
      }

      const attachments = n.attachments;
      for (const a of attachments) {
        if (a.type === 'sticker' && !a.url && a.id && api) a.url = await this.profiles.sticker(api, a.id);
      }

      const senderName = n.isOutbound
        ? (account?.display_name ?? 'Tôi')
        : (n.senderName ?? convName ?? null);

      const row = {
        account_id: id,
        thread_id: n.threadId,
        is_group: n.isGroup,
        zalo_msg_id: n.zaloMsgId,
        cli_msg_id: n.cliMsgId,
        is_outbound: n.isOutbound ? 1 : 0,
        sender_id: n.senderId,
        sender_name: senderName,
        type: n.type,
        text: n.text,
        attachments_json: attachments.length ? JSON.stringify(attachments) : null,
        quote_text: n.quoteText,
        event_time: n.eventTime,
        source,
        raw_json: n.raw,
        created_at: Date.now(),
        conv_name: convName,
        conv_avatar: convAvatar,
        conv_phone: convPhone,
        preview: previewOf({ type: n.type, text: n.text, attachments }),
      };

      const inserted = this.db.insertMessage(row);
      if (n.zaloMsgId) this.db.bumpLastMsgId(id, n.isGroup, n.zaloMsgId);
      if (inserted) {
        this.emit('message', {
          accountId: id, threadId: n.threadId, isGroup: n.isGroup, isOutbound: n.isOutbound,
          preview: row.preview, eventTime: n.eventTime, name: convName ?? existing?.name ?? null, source,
        });
      }
    } catch (err) {
      this.log.error(`Lỗi ghi tin của ${id}: ${err?.stack ?? err}`);
    }
  }

  // ── Dừng / đăng xuất ─────────────────────────────────────────────────────────

  isLive(id) { return this.live.has(id); }
  liveIds() { return [...this.live.keys()]; }

  stop(id, { silent = false } = {}) {
    const live = this.live.get(id);
    if (!live) return;
    try { live.api?.listener?.stop?.(); } catch (err) { this.log.warn(`Dừng listener ${id} lỗi (bỏ qua): ${err?.message ?? err}`); }
    this.live.delete(id);
    if (!silent) this.setStatus(id, 'disconnected');
  }

  /** Đăng xuất = dừng + xoá phiên đã lưu. Tin nhắn đã lưu GIỮ NGUYÊN. */
  logout(id) {
    this.stop(id, { silent: true });
    try { fs.unlinkSync(this.sessionFile(id)); } catch { /* không có file */ }
    this.setStatus(id, 'logged_out');
  }

  stopAll() {
    for (const id of [...this.live.keys()]) this.stop(id, { silent: true });
  }
}
