/**
 * Phía client (bridge cục bộ) nói chuyện với máy chủ xác thực và GIỮ phiên qua các lần tắt máy.
 *
 * Trạng thái lưu ở data/auth.json (quyền 600): serverUrl, user, accessToken + hạn, refreshToken, danh sách chuỗi mã hoá
 * theo phiên bản, phiên bản hiện tại. Có file này là ứng dụng tự mở khoá lúc khởi động — kể cả khi máy chủ tạm không
 * kết nối được (dùng chuỗi đã lưu), rồi đối chiếu lại với máy chủ khi nối được.
 *
 * ⚠️ Ai đọc được file này là giải mã được dữ liệu trên máy — cùng mức rủi ro với cookie Zalo trong sessions/.
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export class AuthClient extends EventEmitter {
  constructor({ authFile, log, defaultServerUrl }) {
    super();
    this.authFile = authFile;
    this.log = log;
    this.defaultServerUrl = defaultServerUrl;
    this.state = this.load();
    this.refreshing = null;
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.authFile, 'utf8')); } catch { return null; }
  }
  save() {
    if (!this.state) { try { fs.unlinkSync(this.authFile); } catch { /* không có */ } return; }
    fs.writeFileSync(this.authFile, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.authFile, 0o600); } catch { /* bỏ qua */ }
  }

  get serverUrl() { return (this.state?.serverUrl || this.defaultServerUrl || '').replace(/\/+$/, ''); }
  /** 'server' = tài khoản trên máy chủ xác thực; 'local' = chế độ dùng thử, chuỗi mã hoá sinh ngay trên máy. */
  get mode() { return this.state?.mode === 'local' ? 'local' : 'server'; }
  get isLoggedIn() { return this.mode === 'local' ? !!(this.state?.user && this.state?.keys?.length) : !!(this.state?.refreshToken && this.state?.user); }
  get user() { return this.state?.user ?? null; }
  get keys() { return this.state?.keys ?? []; }
  get keyVersion() { return Number(this.state?.keyVersion ?? 0); }
  device() { return `${os.hostname()} (${os.platform()} ${os.release()})`; }

  publicState() {
    return {
      loggedIn: this.isLoggedIn,
      mode: this.mode,
      user: this.user,
      serverUrl: this.serverUrl,
      keyVersion: this.keyVersion,
      keyCount: this.keys.length,
      lastSyncAt: this.state?.lastSyncAt ?? null,
      lastServerError: this.state?.lastServerError ?? null,
    };
  }

  async raw(path, { method = 'POST', body, token, serverUrl } = {}) {
    const url = `${(serverUrl ?? this.serverUrl)}${path}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      const e = new Error(`Không kết nối được máy chủ ${serverUrl ?? this.serverUrl}: ${err?.cause?.code ?? err?.message ?? err}`);
      e.network = true;
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.error || `Máy chủ trả lỗi ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  /** Gọi API cần đăng nhập; access token hết hạn thì tự refresh một lần. */
  async authed(path, opts = {}) {
    if (this.mode === 'local') throw Object.assign(new Error('Chế độ dùng thử không nối máy chủ.'), { status: 400 });
    if (!this.isLoggedIn) throw Object.assign(new Error('Chưa đăng nhập.'), { status: 401 });
    if (!this.state.accessToken || Date.now() > Number(this.state.accessExp ?? 0) - 30000) await this.refresh();
    try {
      return await this.raw(path, { ...opts, token: this.state.accessToken });
    } catch (err) {
      if (err.status !== 401) throw err;
      await this.refresh();
      return this.raw(path, { ...opts, token: this.state.accessToken });
    }
  }

  applySession(data, serverUrl) {
    const keys = Array.isArray(data.keys) ? data.keys : (data.encryptionKey ? [data.encryptionKey] : this.keys);
    const version = data.encryptionKey?.version ?? this.keyVersion;
    this.state = {
      ...(this.state ?? {}),
      serverUrl: serverUrl ?? this.serverUrl,
      user: data.user ?? this.user,
      accessToken: data.accessToken,
      accessExp: Date.now() + Number(data.accessExpiresIn ?? 900) * 1000,
      refreshToken: data.refreshToken ?? this.state?.refreshToken,
      keys: mergeKeys(this.state?.keys, keys),
      keyVersion: version,
      lastSyncAt: Date.now(),
      lastServerError: null,
    };
    this.save();
    this.emit('changed', this.publicState());
  }

  async register({ email, password, name, registrationCode, serverUrl }) {
    const url = (serverUrl || this.serverUrl).replace(/\/+$/, '');
    const data = await this.raw('/api/auth/register', { body: { email, password, name, registrationCode, device: this.device() }, serverUrl: url });
    this.applySession(data, url);
    return this.publicState();
  }

  /**
   * Chế độ DÙNG THỬ không máy chủ (thiết bị không có Docker): tự sinh danh tính + chuỗi mã hoá 32 byte ngay trên máy.
   * Dữ liệu chỉ đọc được trên máy này; thoát chế độ hoặc chuyển sang tài khoản thật ⇒ dữ liệu thử phải xoá (khác khoá).
   */
  loginLocal({ name } = {}) {
    const now = Date.now();
    this.state = {
      mode: 'local', serverUrl: null,
      user: { id: `local-${crypto.randomUUID()}`, email: 'dung-thu@may-nay', name: String(name ?? '').trim() || 'Dùng thử (không máy chủ)', createdAt: now, lastLoginAt: now },
      keys: [{ version: 1, key: crypto.randomBytes(32).toString('base64') }], keyVersion: 1, lastSyncAt: null, lastServerError: null,
    };
    this.save();
    this.emit('changed', this.publicState());
    return this.publicState();
  }

  async login({ email, password, serverUrl }) {
    const url = (serverUrl || this.serverUrl).replace(/\/+$/, '');
    const data = await this.raw('/api/auth/login', { body: { email, password, device: this.device() }, serverUrl: url });
    this.applySession(data, url);
    await this.syncKeys().catch(() => undefined);
    return this.publicState();
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const data = await this.raw('/api/auth/refresh', { body: { refreshToken: this.state.refreshToken } });
        this.applySession(data);
      } catch (err) {
        if (err.status === 401) {
          // Refresh token hết hạn/bị thu hồi ⇒ phiên máy chủ chết. Vẫn GIỮ chuỗi mã hoá cục bộ để dữ liệu đọc được,
          // chỉ xoá token; giao diện sẽ yêu cầu đăng nhập lại.
          this.state = { ...this.state, accessToken: null, refreshToken: null, lastServerError: err.message };
          this.save();
          this.emit('changed', this.publicState());
        } else if (this.state) {
          this.state.lastServerError = err.message; this.save();
        }
        throw err;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  /** Lấy danh sách chuỗi từ máy chủ; trả true nếu phiên bản hiện tại đổi (thiết bị khác đã đổi chuỗi). */
  async syncKeys() {
    if (this.mode === 'local') return false;
    const data = await this.authed('/api/keys', { method: 'GET' });
    const before = this.keyVersion;
    this.state.keys = mergeKeys(this.state.keys, data.versions ?? []);
    this.state.keyVersion = Number(data.current?.version ?? before);
    this.state.lastSyncAt = Date.now();
    this.save();
    this.emit('changed', this.publicState());
    return this.state.keyVersion !== before;
  }

  async rotateKey() {
    if (this.mode === 'local') {
      const v = this.keyVersion + 1;
      this.state.keys = mergeKeys(this.state.keys, [{ version: v, key: crypto.randomBytes(32).toString('base64') }]);
      this.state.keyVersion = v; this.save(); this.emit('changed', this.publicState());
      return { version: v };
    }
    const data = await this.authed('/api/keys/rotate', { method: 'POST' });
    this.state.keys = mergeKeys(this.state.keys, [data.current, data.previous].filter(Boolean));
    this.state.keyVersion = Number(data.current.version);
    this.save();
    this.emit('changed', this.publicState());
    return { version: this.state.keyVersion };
  }

  async changePassword(currentPassword, newPassword) {
    if (this.mode === 'local') throw Object.assign(new Error('Chế độ dùng thử không có mật khẩu.'), { status: 400 });
    return this.authed('/api/me/change-password', { body: { currentPassword, newPassword } });
  }

  async forgotPassword(email, serverUrl) {
    const url = (serverUrl || this.serverUrl).replace(/\/+$/, '');
    return this.raw('/api/auth/forgot-password', { body: { email }, serverUrl: url });
  }
  async resetPassword(email, code, newPassword, serverUrl) {
    const url = (serverUrl || this.serverUrl).replace(/\/+$/, '');
    return this.raw('/api/auth/reset-password', { body: { email, code, newPassword }, serverUrl: url });
  }

  /** Đăng xuất: thu hồi refresh token trên máy chủ, xoá auth.json (kể cả chuỗi mã hoá — dữ liệu trên máy trở thành không đọc được cho tới lần đăng nhập sau). */
  async logout() {
    const rt = this.mode === 'server' ? this.state?.refreshToken : null;
    if (rt) { try { await this.raw('/api/auth/logout', { body: { refreshToken: rt } }); } catch { /* máy chủ không nối được cũng vẫn đăng xuất cục bộ */ } }
    this.state = null;
    this.save();
    this.emit('changed', this.publicState());
  }

  setServerUrl(url) {
    const clean = String(url ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/.test(clean)) throw new Error('Địa chỉ máy chủ không hợp lệ (cần bắt đầu bằng http:// hoặc https://).');
    this.state = { ...(this.state ?? {}), serverUrl: clean };
    this.save();
    return this.serverUrl;
  }

  async ping(serverUrl) {
    const data = await this.raw('/health', { method: 'GET', serverUrl: (serverUrl || this.serverUrl).replace(/\/+$/, '') });
    return data;
  }
}

function mergeKeys(existing = [], incoming = []) {
  const map = new Map();
  for (const k of [...(existing ?? []), ...(incoming ?? [])]) if (k?.key && k?.version !== undefined) map.set(Number(k.version), { version: Number(k.version), key: k.key });
  return [...map.values()].sort((a, b) => b.version - a.version);
}
