/** Quản trị người dùng: xem, đổi tên/vai trò/khoá, và LẤY MÃ đặt lại mật khẩu hộ khi máy chủ không có SMTP. */
import { Router } from 'express';
import { config } from '../../config.js';
import { sha256, resetCode } from '../../security.js';
import { User } from '../../models/User.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { ResetCode } from '../../models/ResetCode.js';
import { currentKey } from '../../services/keys.js';
import { revokeAll } from '../../services/tokens.js';
import { wrap } from '../../middleware/errors.js';

export const adminUsersRouter = Router();

adminUsersRouter.get('/', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

  const filter = q ? { $or: [{ email: { $regex: q, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }] } : {};
  const [rows, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  const now = Date.now();
  const items = await Promise.all(rows.map(async (u) => ({
    ...u.toPublic(),
    disabled: !!u.disabled,
    keyVersion: (await currentKey(u._id))?.version ?? 0,
    sessions: await RefreshToken.countDocuments({ userId: u._id, revokedAt: null, expiresAt: { $gt: now } }),
  })));

  res.json({ items, total, page, limit });
}));

adminUsersRouter.patch('/:id', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
  const b = req.body ?? {};

  if (b.name !== undefined) user.name = String(b.name ?? '').trim().slice(0, 100) || null;

  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) return res.status(400).json({ error: 'Vai trò chỉ nhận `user` hoặc `admin`.' });
    // Không cho hạ quyền admin CUỐI CÙNG — mất hết admin là không ai vào lại được trang quản trị.
    if (user.role === 'admin' && b.role !== 'admin') {
      const admins = await User.countDocuments({ role: 'admin', disabled: false });
      if (admins <= 1) return res.status(400).json({ error: 'Đây là quản trị viên cuối cùng, không thể hạ quyền.' });
    }
    user.role = b.role;
  }

  if (b.disabled !== undefined) {
    const disabled = b.disabled === true || b.disabled === 'true';
    if (disabled && user.role === 'admin') {
      const admins = await User.countDocuments({ role: 'admin', disabled: false });
      if (admins <= 1) return res.status(400).json({ error: 'Đây là quản trị viên cuối cùng, không thể khoá.' });
    }
    user.disabled = disabled;
    if (disabled) await revokeAll(user._id);   // khoá tài khoản phải đá luôn mọi phiên đang mở
  }

  user.updatedAt = Date.now();
  await user.save();
  res.json({ user: { ...user.toPublic(), disabled: !!user.disabled } });
}));

/** Sinh mã đặt lại mật khẩu để admin đọc cho người dùng qua điện thoại/Zalo (không cần SMTP). */
adminUsersRouter.post('/:id/reset-code', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  const code = resetCode();
  const expiresAt = Date.now() + config.resetTtlMin * 60e3;
  await ResetCode.create({ userId: user._id, codeHash: sha256(code), createdAt: Date.now(), expiresAt });
  console.log(`[admin] Cấp mã đặt lại mật khẩu cho ${user.email} (quản trị viên ${req.user.email})`);
  res.json({ code, expiresAt });
}));
