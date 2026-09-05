/** Xác thực Bearer + chặn theo vai trò. Thông báo lỗi giữ NGUYÊN câu chữ của máy chủ cũ. */
import { config } from '../config.js';
import { verifyJwt } from '../security.js';
import { User } from '../models/User.js';

/** Gắn `req.user` (tài liệu Mongoose) và `req.token` (payload JWT). 401 nếu thiếu/hết hạn/bị khoá. */
export async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const payload = token ? verifyJwt(token, config.jwtSecret) : null;
    if (!payload || payload.typ !== 'access') {
      return res.status(401).json({ error: 'Phiên đã hết hạn, hãy đăng nhập lại.', code: 'TOKEN_INVALID' });
    }
    const user = await User.findById(payload.sub);
    if (!user || user.disabled) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị khoá.', code: 'USER_INVALID' });
    }
    req.user = user;
    req.token = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/** Dùng SAU requireUser. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.', code: 'FORBIDDEN' });
  }
  next();
}
