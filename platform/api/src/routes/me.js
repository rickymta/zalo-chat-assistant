/** Hồ sơ, đổi mật khẩu, danh sách phiên đăng nhập. Tất cả cần Bearer token. */
import { Router } from 'express';
import { verifyPassword, hashPassword } from '../security.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { currentKey } from '../services/keys.js';
import { requireUser } from '../middleware/auth.js';
import { wrap } from '../middleware/errors.js';

const MIN_PASSWORD = 8;

export const meRouter = Router();
meRouter.use(requireUser);

meRouter.get('/', wrap(async (req, res) => {
  const key = await currentKey(req.user._id);
  res.json({ user: req.user.toPublic(), keyVersion: key?.version ?? 0 });
}));

/**
 * ⚠️ Mật khẩu hiện tại sai trả **400**, không phải 401 (hợp đồng ghi 401 nhưng máy chủ cũ trả 400).
 * Giữ 400 là CÓ CHỦ Ý: `AuthClient.authed()` của ứng dụng desktop bắt 401 để tự refresh rồi GỌI LẠI —
 * trả 401 ở đây sẽ khiến app xoay vòng token và gọi lại đúng một lần nữa với mật khẩu vẫn sai.
 */
meRouter.post('/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!verifyPassword(String(currentPassword ?? ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.', code: 'WRONG_PASSWORD' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự.` });
  }
  req.user.passwordHash = hashPassword(newPassword);
  req.user.updatedAt = Date.now();
  await req.user.save();
  res.json({ ok: true });
}));

/** Phiên đang mở = refresh token chưa thu hồi, chưa hết hạn. `current` nhận ra qua `rtid` trong JWT. */
meRouter.get('/sessions', wrap(async (req, res) => {
  const rows = await RefreshToken.find({ userId: req.user._id, revokedAt: null, expiresAt: { $gt: Date.now() } })
    .sort({ createdAt: -1 })
    .lean();
  res.json({
    items: rows.map((r) => ({
      id: String(r._id),
      device: r.device ?? null,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      current: !!req.token?.rtid && r.tokenHash.startsWith(req.token.rtid),
    })),
  });
}));

meRouter.delete('/sessions/:id', wrap(async (req, res) => {
  const row = await RefreshToken.findOne({ _id: req.params.id, userId: req.user._id }).catch(() => null);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy phiên đăng nhập này.' });
  if (!row.revokedAt) { row.revokedAt = Date.now(); await row.save(); }
  res.json({ ok: true });
}));
