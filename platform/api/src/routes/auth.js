/**
 * Xác thực — mục 2 hợp đồng. TÊN ROUTE, TÊN TRƯỜNG, MÃ HTTP và CÂU LỖI giữ nguyên như máy chủ cũ
 * (`server/src/routes.js`): ứng dụng desktop đang cài trên máy người dùng gọi thẳng vào đây và
 * KHÔNG được sửa để chạy tiếp.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { hashPassword, verifyPassword, sha256, resetCode } from '../security.js';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ResetCode } from '../models/ResetCode.js';
import { sessionPayload, revokeAll } from '../services/tokens.js';
import { addKey } from '../services/keys.js';
import { mailer } from '../services/mailer.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { wrap } from '../middleware/errors.js';
import { newClientKey } from '../security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Hợp đồng mục 1: 10 lượt/phút/IP cho login|register|forgot-password|reset-password. */
const limit = (group) => rateLimit({ windowMs: 60_000, max: 10, group });

const norm = (e) => String(e ?? '').trim().toLowerCase();
/** Admin đầu tiên: email nằm trong ADMIN_EMAILS luôn được nâng quyền. */
const isBootstrapAdmin = (email) => config.adminEmails.includes(norm(email));

export const authRouter = Router();

// ── Đăng ký ───────────────────────────────────────────────────────────────────
authRouter.post('/register', limit('reg'), wrap(async (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ error: 'Máy chủ không cho phép tự đăng ký. Liên hệ quản trị viên.' });
  }
  const { email, password, name, registrationCode, device } = req.body ?? {};
  if (!EMAIL_RE.test(String(email ?? ''))) return res.status(400).json({ error: 'Email không hợp lệ.' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.` });
  }
  if (config.registrationCode && registrationCode !== config.registrationCode) {
    return res.status(403).json({ error: 'Mã đăng ký không đúng.' });
  }
  if (await User.findOne({ email: norm(email) }).select('_id').lean()) {
    return res.status(409).json({ error: 'Email này đã được đăng ký.' });
  }

  const now = Date.now();
  const user = await User.create({
    _id: crypto.randomUUID(),
    email: norm(email),
    name: typeof name === 'string' ? name.trim().slice(0, 100) || null : null,
    passwordHash: hashPassword(password),
    role: isBootstrapAdmin(email) ? 'admin' : 'user',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
  // Cấp chuỗi mã hoá phiên bản 1 ngay khi đăng ký — ứng dụng cần khoá trước khi ghi dòng dữ liệu đầu tiên.
  const key = await addKey(user._id, newClientKey(), 'server');

  console.log(`[auth] Đăng ký: ${user.email}`);
  const payload = await sessionPayload(user, device);
  res.json({ ...payload, encryptionKey: { version: key.version, key: key.key } });
}));

// ── Đăng nhập / refresh / đăng xuất ──────────────────────────────────────────
authRouter.post('/login', limit('login'), wrap(async (req, res) => {
  const { email, password, device } = req.body ?? {};
  const user = await User.findOne({ email: norm(email) });
  // Cùng một thông báo cho sai email và sai mật khẩu — không để lộ email nào đã tồn tại.
  if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
  }
  if (user.disabled) return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });

  user.lastLoginAt = Date.now();
  if (isBootstrapAdmin(user.email) && user.role !== 'admin') {
    user.role = 'admin';
    console.log(`[auth] Nâng quyền quản trị theo ADMIN_EMAILS: ${user.email}`);
  }
  await user.save();

  res.json(await sessionPayload(user, device));
}));

authRouter.post('/refresh', wrap(async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) return res.status(400).json({ error: 'Thiếu refreshToken.' });

  const hash = sha256(refreshToken);
  const row = await RefreshToken.findOne({ tokenHash: hash });
  if (!row || row.revokedAt || row.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Phiên đã hết hạn, hãy đăng nhập lại.' });
  }
  const user = await User.findById(row.userId);
  if (!user || user.disabled) {
    return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị khoá.' });
  }

  // Xoay vòng: token cũ bị thu hồi, phát token mới — token cũ lọt ra ngoài cũng chỉ dùng được một lần.
  const payload = await sessionPayload(user, row.device);
  row.revokedAt = Date.now();
  row.replacedBy = sha256(payload.refreshToken).slice(0, 12);
  await row.save();

  res.json(payload);
}));

authRouter.post('/logout', wrap(async (req, res) => {
  const { refreshToken, all } = req.body ?? {};
  if (refreshToken) {
    const row = await RefreshToken.findOne({ tokenHash: sha256(refreshToken) });
    if (row) {
      if (all) await revokeAll(row.userId);
      else if (!row.revokedAt) { row.revokedAt = Date.now(); await row.save(); }
    }
  }
  res.json({ ok: true });   // luôn 200 — đăng xuất không bao giờ được làm người dùng kẹt
}));

// ── Quên mật khẩu ─────────────────────────────────────────────────────────────
authRouter.post('/forgot-password', limit('forgot'), wrap(async (req, res) => {
  const { email } = req.body ?? {};
  const user = await User.findOne({ email: norm(email) });
  // Luôn trả cùng một câu — không để lộ email có tồn tại không.
  const generic = {
    ok: true,
    message: `Nếu email tồn tại, mã đặt lại mật khẩu đã được gửi. Mã có hiệu lực ${config.resetTtlMin} phút.`,
    delivery: mailer.configured ? 'email' : 'server-log',
  };
  if (!user) return res.json(generic);

  const code = resetCode();
  await ResetCode.create({
    userId: user._id,
    codeHash: sha256(code),
    createdAt: Date.now(),
    expiresAt: Date.now() + config.resetTtlMin * 60e3,
  });
  try {
    await mailer.sendResetCode(user.email, code, config.resetTtlMin);
  } catch (err) {
    console.error(`[auth] Gửi email đặt lại mật khẩu thất bại: ${err?.message ?? err}`);
  }
  res.json(generic);
}));

authRouter.post('/reset-password', limit('reset'), wrap(async (req, res) => {
  const { email, code, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.` });
  }
  const user = await User.findOne({ email: norm(email) });
  if (!user) return res.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn.' });

  const codeHash = sha256(String(code ?? '').trim().toUpperCase());
  const active = await ResetCode.find({ userId: user._id, usedAt: null, expiresAt: { $gt: Date.now() } }).sort({ createdAt: -1 });
  const match = active.find((r) => r.attempts < 5 && r.codeHash === codeHash);
  if (!match) {
    // Sai một lần thì mọi mã đang mở của người này đều bị đếm — chặn dò mã kiểu vét cạn.
    await ResetCode.updateMany({ _id: { $in: active.map((r) => r._id) } }, { $inc: { attempts: 1 } });
    return res.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn.' });
  }

  match.usedAt = Date.now();
  await match.save();
  user.passwordHash = hashPassword(newPassword);
  user.updatedAt = Date.now();
  await user.save();
  await revokeAll(user._id);   // mọi thiết bị khác phải đăng nhập lại

  console.log(`[auth] Đặt lại mật khẩu: ${user.email}`);
  res.json({ ok: true });
}));
