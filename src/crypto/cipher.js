/**
 * Mã hoá từng trường trong SQLite bằng AES-256-GCM.
 *
 * Định dạng giá trị đã mã hoá:  enc:v<phiên bản khoá>:<base64(iv 12B | tag 16B | ciphertext)>
 * - Phiên bản khoá nằm ngay trong giá trị ⇒ đổi chuỗi mã hoá thì mã hoá lại theo lô, dừng giữa chừng vẫn tiếp tục được.
 * - Giá trị KHÔNG có tiền tố `enc:v` là dữ liệu cũ chưa mã hoá (coi như phiên bản 0) — được mã hoá ở lượt mã hoá lại.
 * - Khoá AES dẫn xuất từ chuỗi máy chủ cấp bằng HKDF-SHA256 với salt theo user id: cùng một chuỗi ở hai tài khoản
 *   khác nhau cho hai khoá khác nhau.
 */
import crypto from 'node:crypto';

const PREFIX = 'enc:v';
const RE = /^enc:v(\d+):(.+)$/s;

export function deriveKey(secret, userId) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret), 'utf8'), Buffer.from(`zca-field-salt:${userId}`, 'utf8'), Buffer.from('zca-db-field-v1', 'utf8'), 32));
}

export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);
/** 0 = chưa mã hoá; -1 = không phải chuỗi/null; n = phiên bản khoá. */
export function versionOf(v) {
  if (v === null || v === undefined) return -1;
  if (typeof v !== 'string') return -1;
  const m = RE.exec(v);
  return m ? Number(m[1]) : 0;
}

export class Cipher {
  constructor() {
    this.keys = new Map();   // version → Buffer 32 byte
    this.version = 0;        // phiên bản đang dùng để MÃ HOÁ
    this.userId = null;
    this.warned = new Set();
  }

  /** @param {{version:number, key:string}[]} entries — mọi phiên bản còn biết; currentVersion = phiên bản dùng để mã hoá */
  setKeys(userId, entries, currentVersion) {
    this.userId = userId;
    this.keys = new Map();
    for (const e of entries ?? []) {
      if (!e?.key || !Number.isFinite(Number(e.version))) continue;
      this.keys.set(Number(e.version), deriveKey(e.key, userId));
    }
    this.version = Number(currentVersion ?? 0);
    if (!this.keys.has(this.version)) throw new Error(`Thiếu khoá cho phiên bản ${this.version}.`);
  }

  clear() { this.keys = new Map(); this.version = 0; this.userId = null; }
  get ready() { return this.version > 0 && this.keys.has(this.version); }
  hasVersion(v) { return v === 0 || this.keys.has(v); }

  encrypt(value) {
    if (value === null || value === undefined) return null;
    if (!this.ready) throw new Error('Chưa mở khoá mã hoá.');
    const key = this.keys.get(this.version);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
    return `${PREFIX}${this.version}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
  }

  /** Không bao giờ ném: hỏng thì trả chuỗi đánh dấu để giao diện vẫn hiện được dòng đó. */
  decrypt(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    const m = RE.exec(value);
    if (!m) return value;   // dữ liệu cũ chưa mã hoá
    const v = Number(m[1]);
    const key = this.keys.get(v);
    if (!key) { this.warnOnce(`thiếu khoá phiên bản ${v}`); return '[không giải mã được — thiếu khoá phiên bản ' + v + ']'; }
    try {
      const buf = Buffer.from(m[2], 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    } catch {
      this.warnOnce(`giải mã lỗi phiên bản ${v}`);
      return '[không giải mã được]';
    }
  }

  /** Giá trị cần mã hoá lại nếu chưa mã hoá hoặc dùng phiên bản khác phiên bản hiện tại. */
  needsReencrypt(value) {
    const v = versionOf(value);
    return v >= 0 && v !== this.version;
  }

  warnOnce(msg) { if (!this.warned.has(msg)) { this.warned.add(msg); this.onWarn?.(msg); } }
}
