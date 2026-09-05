/** Phát access token (JWT) + refresh token (chuỗi ngẫu nhiên, lưu băm SHA-256 hex). */
import { config } from '../config.js';
import { signJwt, randomToken, sha256 } from '../security.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { currentKey } from './keys.js';

/**
 * Payload JWT là BỘI của máy chủ cũ: giữ `sub`, `email`, `kv`, `typ` (middleware cũ và mới đều kiểm
 * `typ === 'access'`), thêm `role` (hợp đồng mục 1) và `rtid` (12 ký tự đầu của băm refresh token) để
 * màn "Phiên đăng nhập" biết đâu là phiên hiện tại.
 */
export async function issueTokens(user, device) {
  const keyRow = await currentKey(user._id);
  const refreshToken = randomToken(32);
  const hash = sha256(refreshToken);
  const now = Date.now();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hash,
    device: device ?? null,
    createdAt: now,
    expiresAt: now + config.refreshTtlDays * 86400e3,
  });

  const accessToken = signJwt(
    { sub: user._id, email: user.email, role: user.role ?? 'user', kv: keyRow?.version ?? 0, rtid: hash.slice(0, 12), typ: 'access' },
    config.jwtSecret,
    config.accessTtlSec,
  );

  return { accessToken, accessExpiresIn: config.accessTtlSec, refreshToken };
}

/** Gói phản hồi chung của register/login/refresh — hình dạng ứng dụng desktop đang dựa vào. */
export async function sessionPayload(user, device) {
  const tokens = await issueTokens(user, device);
  const key = await currentKey(user._id);
  return {
    user: user.toPublic(),
    ...tokens,
    encryptionKey: key ? { version: key.version, key: key.key } : null,
  };
}

export async function revokeAll(userId) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: Date.now() } });
}
