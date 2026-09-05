/**
 * Băm mật khẩu (scrypt), JWT HS256, token ngẫu nhiên — chỉ dùng node:crypto, không thêm thư viện.
 *
 * ⚠️ ĐỒNG BỘ TỪNG BYTE với `server/src/security.js` của máy chủ cũ:
 *  - chuỗi băm `scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>` với N=2^15, r=8, p=1, keylen 32
 *  - sha256 trả HEX (không phải base64url) — refresh token cũ trong SQLite băm kiểu này, đổi là mọi
 *    thiết bị đang đăng nhập bị đá ra.
 * Sửa file này = làm hỏng đăng nhập của người dùng cũ. Đừng "tối ưu".
 */
import crypto from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
export function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/** Mã đặt lại mật khẩu 8 ký tự dễ gõ (không có 0/O, 1/I). */
export function resetCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Chuỗi mã hoá cấp cho client: 32 byte ngẫu nhiên, base64url (43 ký tự). */
export function newClientKey() { return crypto.randomBytes(32).toString('base64url'); }

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload, secret, ttlSec) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
