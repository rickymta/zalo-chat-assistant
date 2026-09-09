/**
 * Telegram bằng TÀI KHOẢN CÁ NHÂN (MTProto qua gramjs) — đọc các nhóm người dùng chọn, lưu tin vào CÙNG bảng hội thoại với Zalo:
 *   account_id = "tg:<id người dùng>", thread_id = "tg:<id nhóm>", is_group = 1 (kênh/nhóm) hoặc 0 (chat riêng nếu chọn).
 * ⇒ danh sách hội thoại, xuất gói du-lieu/, pipeline AI, báo cáo, gợi ý dùng nguyên; chỉ KHÔNG gửi tin (chỉ đọc).
 *
 * Đăng nhập không tương tác: giao diện gọi startLogin(phone) → gramjs hỏi mã/2FA qua callback → ta chờ submitCode()/submitPassword().
 * Phiên (StringSession) + API ID/Hash lưu ở data/telegram.json (quyền 600); chuỗi phiên được mã hoá bằng chuỗi mã hoá của tài khoản
 * khi đã mở khoá (mất chuỗi ⇒ đăng nhập lại, tin đã lưu vẫn còn).
 *
 * Nguyên tắc: chỉ đọc; không đánh dấu đã đọc, không gửi, không chuyển tiếp. Tôn trọng FloodWait của Telegram (nghỉ giữa các nhóm).
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { isEncrypted } from '../crypto/cipher.js';
import { previewOf } from '../zalo/normalize.js';

const require = createRequire(import.meta.url);
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const ID_PREFIX = 'tg:';
const HISTORY_LIMIT_PER_CHAT = 400;

export const isTelegramAccount = (accountId) => String(accountId ?? '').startsWith(ID_PREFIX);

function displayNameOf(entity) {
  if (!entity) return null;
  if (entity.title) return String(entity.title);
  const n = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();
  return n || (entity.username ? `@${entity.username}` : null);
}

/** Phân loại media của gramjs → attachment kiểu Zalo để giao diện/AI hiểu chung một ngôn ngữ. */
function attachmentsOf(msg) {
  const out = [];
  try {
    if (msg.photo) out.push({ type: 'image', name: 'Ảnh', url: null });
    else if (msg.sticker) out.push({ type: 'sticker', name: 'Sticker', url: null });
    else if (msg.voice) out.push({ type: 'voice', name: 'Tin thoại', url: null });
    else if (msg.video || msg.videoNote) out.push({ type: 'video', name: 'Video', url: null });
    else if (msg.document) {
      const attr = (msg.document.attributes || []).find((a) => a.className === 'DocumentAttributeFilename');
      out.push({ type: 'file', name: attr?.fileName || 'Tệp', url: null });
    } else if (msg.media?.className === 'MessageMediaContact') out.push({ type: 'contact', name: `${[msg.media.firstName, msg.media.lastName].filter(Boolean).join(' ')} — ${msg.media.phoneNumber}`, url: null });
    else if (msg.media?.className === 'MessageMediaPoll') out.push({ type: 'poll', name: 'Bình chọn', url: null });
    else if (msg.media?.className === 'MessageMediaGeo' || msg.media?.className === 'MessageMediaVenue') out.push({ type: 'location', name: 'Vị trí', url: null });
  } catch { /* media lạ — bỏ qua */ }
  return out;
}

export class TelegramManager extends EventEmitter {
  /** @param {{ db: any, log: any, file: string, getCipher: () => any }} deps */
  constructor({ db, log, file, getCipher }) {
    super();
    this.db = db; this.log = log; this.file = file; this.getCipher = getCipher;
    this.client = null;
    this.pending = { code: null, password: null };
    this.state = {
      configured: false, status: 'disconnected', phone: null, selfId: null, displayName: null, username: null, error: null,
      codeHint: null, passwordHint: null, watched: [], historyDays: 7, lastSyncAt: null, syncing: false, syncProgress: null, messagesToday: 0,
    };
    this.data = this.load();
    this.state.configured = !!(this.data.apiId && this.data.apiHash);
    this.state.phone = this.data.phone ?? null;
    this.state.selfId = this.data.selfId ?? null;
    this.state.displayName = this.data.displayName ?? null;
    this.state.username = this.data.username ?? null;
    this.state.watched = Array.isArray(this.data.watched) ? this.data.watched : [];
    this.state.historyDays = Number(this.data.historyDays ?? 7);
    this.senderCache = new Map();
  }

  // ── Lưu trữ ──────────────────────────────────────────────────────────────────
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.file, 0o600); } catch { /* bỏ qua */ }
  }
  /** Chuỗi phiên: mã hoá khi có chuỗi mã hoá; đọc được cả bản chưa mã hoá (chuyển đổi dần). */
  sessionString() {
    const raw = this.data.session; if (!raw) return '';
    if (!isEncrypted(raw)) return raw;
    const c = this.getCipher?.();
    try { return c?.ready ? c.decrypt(raw) : ''; } catch { return ''; }
  }
  setSessionString(s) {
    const c = this.getCipher?.();
    this.data.session = s ? (c?.ready ? c.encrypt(s) : s) : null;
    this.save();
  }

  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }
  status() { return { ...this.state, watched: this.state.watched.map((w) => ({ ...w })), accountId: this.state.selfId ? ID_PREFIX + this.state.selfId : null }; }
  setStatus(status, error = null) { this.state.status = status; this.state.error = error; this.emitChange(); }

  configure({ apiId, apiHash }) {
    const id = Number(apiId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('API ID phải là số nguyên dương (lấy tại my.telegram.org).'), { status: 400 });
    if (!/^[0-9a-f]{32}$/i.test(String(apiHash ?? '').trim())) throw Object.assign(new Error('API Hash phải là 32 ký tự hex.'), { status: 400 });
    this.data.apiId = id; this.data.apiHash = String(apiHash).trim(); this.save();
    this.state.configured = true; this.emitChange();
    return this.status();
  }

  makeClient() {
    const session = new StringSession(this.sessionString());
    const client = new TelegramClient(session, Number(this.data.apiId), String(this.data.apiHash), {
      connectionRetries: 5, retryDelay: 2000, autoReconnect: true, useWSS: false,
      deviceModel: 'Zalo Chat Assistant', appVersion: '0.1', systemVersion: process.platform === 'darwin' ? 'macOS' : process.platform,
    });
    client.setLogLevel?.('error');
    return client;
  }

  // ── Đăng nhập ────────────────────────────────────────────────────────────────
  waitInput(kind) {
    return new Promise((resolve, reject) => { this.pending[kind] = { resolve, reject }; });
  }
  /** Bắt đầu đăng nhập: gửi mã tới điện thoại; trạng thái chuyển sang awaiting_code, giao diện gọi submitCode(). */
  async startLogin(phone) {
    if (!this.state.configured) throw Object.assign(new Error('Chưa có API ID/API Hash — nhập ở phần Telegram trong Cài đặt.'), { status: 400 });
    const p = String(phone ?? '').replace(/[\s-]/g, '');
    if (!/^\+?\d{8,15}$/.test(p)) throw Object.assign(new Error('Số điện thoại không hợp lệ (ví dụ +84912345678).'), { status: 400 });
    if (this.loginTask) throw Object.assign(new Error('Đang có một lượt đăng nhập — nhập mã hoặc bấm Huỷ trước.'), { status: 409 });
    await this.stop();
    this.data.session = null; this.data.phone = p; this.save();
    this.state.phone = p; this.state.codeHint = null; this.state.passwordHint = null;
    this.setStatus('connecting');
    const client = this.makeClient();
    this.client = client;
    this.loginTask = (async () => {
      try {
        await client.connect();
        await client.signInUser({ apiId: Number(this.data.apiId), apiHash: String(this.data.apiHash) }, {
          phoneNumber: p,
          phoneCode: async (isCodeViaApp) => { this.state.codeHint = isCodeViaApp ? 'Mã được gửi vào ứng dụng Telegram trên điện thoại/máy khác đang đăng nhập.' : 'Mã được gửi qua SMS.'; this.setStatus('awaiting_code'); return this.waitInput('code'); },
          password: async (hint) => { this.state.passwordHint = hint || null; this.setStatus('awaiting_password'); return this.waitInput('password'); },
          onError: async (err) => { this.state.error = err?.message ?? String(err); this.emitChange(); return true; },
        });
        this.setSessionString(client.session.save());
        await this.afterConnected(client);
      } catch (err) {
        if (err?.message !== 'cancelled') { this.log?.warn(`Telegram: đăng nhập thất bại: ${err?.message ?? err}`); this.setStatus('error', err?.message ?? String(err)); }
        try { await client.disconnect(); } catch { /* bỏ qua */ }
        if (this.client === client) this.client = null;
      } finally {
        this.loginTask = null; this.pending = { code: null, password: null };
      }
    })();
    return this.status();
  }
  submitCode(code) {
    const c = String(code ?? '').replace(/\D/g, '');
    if (!this.pending.code) throw Object.assign(new Error('Chưa tới bước nhập mã.'), { status: 409 });
    if (c.length < 4) throw Object.assign(new Error('Mã phải có ít nhất 4 chữ số.'), { status: 400 });
    this.setStatus('connecting'); this.pending.code.resolve(c); this.pending.code = null;
    return this.status();
  }
  submitPassword(password) {
    if (!this.pending.password) throw Object.assign(new Error('Tài khoản này không hỏi mật khẩu hai lớp, hoặc chưa tới bước đó.'), { status: 409 });
    if (!password) throw Object.assign(new Error('Mật khẩu hai lớp trống.'), { status: 400 });
    this.setStatus('connecting'); this.pending.password.resolve(String(password)); this.pending.password = null;
    return this.status();
  }
  async cancelLogin() {
    for (const k of ['code', 'password']) { this.pending[k]?.reject(new Error('cancelled')); this.pending[k] = null; }
    await this.stop();
    this.setStatus('disconnected');
    return this.status();
  }

  /** Sau khi có phiên hợp lệ: lấy hồ sơ, ghi tài khoản vào DB, nghe tin mới, đồng bộ lịch sử các nhóm đang theo dõi. */
  async afterConnected(client) {
    const me = await client.getMe();
    this.state.selfId = String(me.id); this.state.displayName = displayNameOf(me); this.state.username = me.username ?? null;
    this.data.selfId = this.state.selfId; this.data.displayName = this.state.displayName; this.data.username = this.state.username; this.save();
    this.db.upsertAccount({ id: ID_PREFIX + this.state.selfId, displayName: `${this.state.displayName || 'Telegram'} (Telegram)`, avatarUrl: null, phone: this.state.phone, status: 'connected' });
    client.addEventHandler((event) => { void this.onNewMessage(event); }, new NewMessage({}));
    this.setStatus('connected');
    this.log?.info(`Telegram: đã kết nối ${this.state.displayName || ''} (${this.state.phone || ''}), theo dõi ${this.state.watched.length} nhóm.`);
    void this.syncHistory();
  }

  /** Khởi động lại từ phiên đã lưu (gọi sau khi mở khoá dữ liệu). */
  async restore() {
    if (!this.state.configured || !this.sessionString()) return;
    if (this.client) return;
    this.setStatus('connecting');
    const client = this.makeClient(); this.client = client;
    try {
      await client.connect();
      if (!(await client.checkAuthorization())) { this.setStatus('disconnected', 'Phiên Telegram đã hết hạn — hãy đăng nhập lại.'); await client.disconnect(); this.client = null; return; }
      await client.getDialogs({ limit: 200 });   // làm nóng bộ đệm entity để getEntity/getMessages không hỏi lại máy chủ
      await this.afterConnected(client);
    } catch (err) {
      this.log?.warn(`Telegram: không nối lại được: ${err?.message ?? err}`);
      this.setStatus('error', err?.message ?? String(err));
      try { await client.disconnect(); } catch { /* bỏ qua */ }
      this.client = null;
    }
  }

  async stop() {
    const c = this.client; this.client = null;
    if (c) { try { await c.disconnect(); } catch { /* bỏ qua */ } }
    if (this.state.status === 'connected') this.setStatus('disconnected');
  }

  async logout() {
    const c = this.client;
    try { if (c) await c.invoke(new Api.auth.LogOut()); } catch { /* phiên có thể đã chết */ }
    await this.stop();
    if (this.state.selfId) this.db.setAccountStatus(ID_PREFIX + this.state.selfId, 'disconnected');
    this.data.session = null; this.save();
    this.setStatus('disconnected');
    this.log?.info('Telegram: đã đăng xuất (tin đã lưu vẫn giữ).');
    return this.status();
  }

  // ── Danh sách nhóm / chọn theo dõi ───────────────────────────────────────────
  requireClient() {
    if (!this.client || this.state.status !== 'connected') throw Object.assign(new Error('Telegram chưa kết nối.'), { status: 409 });
    return this.client;
  }
  async listDialogs() {
    const client = this.requireClient();
    const dialogs = await client.getDialogs({ limit: 300 });
    const watched = new Set(this.state.watched.map((w) => w.id));
    return dialogs.filter((d) => d.entity && !d.isUser || (d.isUser && !d.entity?.bot)).map((d) => ({
      id: String(d.id), title: d.title || displayNameOf(d.entity) || String(d.id),
      type: d.isChannel ? (d.entity?.megagroup ? 'group' : 'channel') : d.isGroup ? 'group' : 'user',
      members: d.entity?.participantsCount ?? null, unread: d.unreadCount ?? 0,
      lastAt: d.date ? d.date * 1000 : null, watched: watched.has(String(d.id)),
    })).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  }
  async setWatched({ chatIds, titles = {}, historyDays }) {
    const ids = [...new Set((chatIds ?? []).map(String).filter(Boolean))];
    const prev = new Map(this.state.watched.map((w) => [w.id, w]));
    const types = {};
    try { for (const d of await this.listDialogs()) { titles[d.id] ??= d.title; types[d.id] = d.type; } } catch { /* dùng tên đã có */ }
    this.state.watched = ids.map((id) => ({ id, title: titles[id] ?? prev.get(id)?.title ?? id, type: types[id] ?? prev.get(id)?.type ?? 'group', lastMsgId: prev.get(id)?.lastMsgId ?? 0, addedAt: prev.get(id)?.addedAt ?? Date.now() }));
    if (Number.isFinite(Number(historyDays))) this.state.historyDays = Math.min(Math.max(Math.round(Number(historyDays)), 1), 90);
    this.data.watched = this.state.watched; this.data.historyDays = this.state.historyDays; this.save();
    this.emitChange();
    void this.syncHistory();
    return this.status();
  }

  // ── Đồng bộ lịch sử ─────────────────────────────────────────────────────────
  async senderName(msg) {
    try {
      const key = msg.senderId ? String(msg.senderId) : null;
      if (key && this.senderCache.has(key)) return this.senderCache.get(key);
      const s = await msg.getSender();
      const name = displayNameOf(s) || (key ? `Thành viên ${key.slice(-4)}` : 'Ẩn danh');
      if (key) this.senderCache.set(key, name);
      return name;
    } catch { return 'Ẩn danh'; }
  }
  async rowOf(msg, chat, source) {
    const atts = attachmentsOf(msg);
    const text = String(msg.message ?? '').trim() || null;
    if (!text && !atts.length) return null;   // tin dịch vụ (vào nhóm, đổi tên…) bỏ qua
    const senderName = msg.out ? (this.state.displayName || 'Bạn') : await this.senderName(msg);
    return {
      account_id: ID_PREFIX + this.state.selfId, thread_id: ID_PREFIX + chat.id, is_group: chat.type !== 'user',
      zalo_msg_id: String(msg.id), cli_msg_id: null, is_outbound: msg.out ? 1 : 0,
      sender_id: msg.senderId ? String(msg.senderId) : null, sender_name: senderName,
      type: atts.length && !text ? atts[0].type : 'text', text, attachments_json: atts.length ? JSON.stringify(atts) : null,
      quote_text: null, event_time: (msg.date || Math.floor(Date.now() / 1000)) * 1000, source, recalled: 0,
      raw_json: JSON.stringify({ id: msg.id, chatId: chat.id, senderId: msg.senderId ? String(msg.senderId) : null, media: atts[0]?.type ?? null }),
      created_at: Date.now(), conv_name: chat.title, conv_avatar: null, conv_phone: null,
      preview: previewOf({ type: atts.length && !text ? atts[0].type : 'text', text, attachments: atts }),
    };
  }
  /** Kéo tin trong N ngày (hoặc từ tin cuối đã lưu) cho từng nhóm đang theo dõi, tuần tự, nghỉ giữa các nhóm. */
  async syncHistory() {
    if (this.state.syncing || !this.client || this.state.status !== 'connected' || !this.state.watched.length) return;
    this.state.syncing = true; this.state.syncProgress = { done: 0, total: this.state.watched.length, inserted: 0 }; this.emitChange();
    const since = Math.floor((Date.now() - this.state.historyDays * 86400e3) / 1000);
    let inserted = 0;
    try {
      for (const chat of this.state.watched) {
        try {
          const entity = await this.client.getEntity(chat.type === 'user' ? Number(chat.id) : chat.id);
          const opts = { limit: HISTORY_LIMIT_PER_CHAT };
          if (chat.lastMsgId) opts.minId = chat.lastMsgId;
          const msgs = await this.client.getMessages(entity, opts);
          let maxId = chat.lastMsgId || 0;
          for (const m of [...msgs].reverse()) {
            if (!m || typeof m.id !== 'number') continue;
            if (!chat.lastMsgId && m.date && m.date < since) continue;
            const row = await this.rowOf(m, chat, 'old_sync');
            if (row && this.db.insertMessage(row)) inserted++;
            if (m.id > maxId) maxId = m.id;
          }
          chat.lastMsgId = maxId;
        } catch (err) {
          this.log?.warn(`Telegram: không kéo được lịch sử "${chat.title}": ${err?.message ?? err}`);
          if (/FLOOD_WAIT_(\d+)/.test(String(err?.message))) await new Promise((r) => setTimeout(r, Math.min(60, Number(RegExp.$1)) * 1000));
        }
        this.state.syncProgress.done += 1; this.state.syncProgress.inserted = inserted; this.emitChange();
        await new Promise((r) => setTimeout(r, 600));
      }
      this.data.watched = this.state.watched; this.save();
      this.state.lastSyncAt = Date.now();
      if (inserted) { this.log?.info(`Telegram: đồng bộ ${inserted} tin từ ${this.state.watched.length} nhóm.`); this.emit('message', { source: 'old_sync', count: inserted }); }
    } finally {
      this.state.syncing = false; this.state.syncProgress = null; this.emitChange();
    }
  }

  // ── Tin mới theo thời gian thực ─────────────────────────────────────────────
  async onNewMessage(event) {
    try {
      const msg = event.message; if (!msg) return;
      const chatId = String(event.chatId ?? msg.chatId ?? msg.peerId?.channelId ?? msg.peerId?.chatId ?? msg.peerId?.userId ?? '');
      const chat = this.state.watched.find((w) => w.id === chatId || w.id === chatId.replace(/^-100/, '') || `-100${w.id}` === chatId || `-${w.id}` === chatId);
      if (!chat) return;
      const row = await this.rowOf(msg, chat, 'live');
      if (!row) return;
      if (this.db.insertMessage(row)) {
        if (msg.id > (chat.lastMsgId || 0)) { chat.lastMsgId = msg.id; this.data.watched = this.state.watched; this.save(); }
        this.state.messagesToday += 1;
        this.emit('message', { accountId: row.account_id, threadId: row.thread_id, isGroup: !!row.is_group, isOutbound: !!row.is_outbound, preview: row.preview, eventTime: row.event_time, source: 'live' });
      }
    } catch (err) { this.log?.warn(`Telegram: lỗi xử lý tin mới: ${err?.message ?? err}`); }
  }
}
