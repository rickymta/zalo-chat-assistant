/**
 * REST của máy chủ xác thực. Mọi lỗi trả JSON { error: '<tiếng Việt>' }.
 * Máy chủ này KHÔNG nhận, không lưu tin nhắn — chỉ danh tính + chuỗi mã hoá client.
 */
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, randomToken, sha256, resetCode, newClientKey, signJwt, verifyJwt } from './security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Giới hạn tần suất đơn giản theo IP + nhóm — đủ cho công cụ nội bộ, không cần Redis. */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return arr.length <= max;
  };
}

export function registerRoutes(app, { db, config, mailer, log }) {
  const limitAuth = rateLimiter({ windowMs: 10 * 60e3, max: 30 });
  const limitForgot = rateLimiter({ windowMs: 60 * 60e3, max: 5 });

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at, lastLoginAt: u.last_login_at });

  async function issueTokens(user, device) {
    const keyRow = db.currentKey(user.id);
    const accessToken = signJwt({ sub: user.id, email: user.email, kv: keyRow?.version ?? 0, typ: 'access' }, config.jwtSecret, config.accessTtlSec);
    const refreshToken = randomToken(32);
    db.insertRefresh(user.id, sha256(refreshToken), device, Date.now() + config.refreshTtlDays * 86400e3);
    return { accessToken, accessExpiresIn: config.accessTtlSec, refreshToken };
  }

  /** Lấy user từ Bearer token; ném 401 nếu thiếu/hết hạn. */
  function requireUser(req, reply) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const payload = token ? verifyJwt(token, config.jwtSecret) : null;
    if (!payload || payload.typ !== 'access') { reply.code(401).send({ error: 'Phiên đã hết hạn, hãy đăng nhập lại.' }); return null; }
    const user = db.userById(payload.sub);
    if (!user || user.disabled) { reply.code(401).send({ error: 'Tài khoản không tồn tại hoặc đã bị khoá.' }); return null; }
    return user;
  }

  app.get('/health', async () => ({ status: 'ok', users: db.countUsers(), smtp: mailer.configured }));

  // ── Đăng ký ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/register', async (req, reply) => {
    if (!limitAuth(`reg:${req.ip}`)) return reply.code(429).send({ error: 'Thử quá nhiều lần, hãy đợi ít phút.' });
    if (!config.allowRegistration) return reply.code(403).send({ error: 'Máy chủ không cho phép tự đăng ký. Liên hệ quản trị viên.' });
    const { email, password, name, registrationCode, device } = req.body ?? {};
    if (!EMAIL_RE.test(String(email ?? ''))) return reply.code(400).send({ error: 'Email không hợp lệ.' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return reply.code(400).send({ error: `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.` });
    if (config.registrationCode && registrationCode !== config.registrationCode) return reply.code(403).send({ error: 'Mã đăng ký không đúng.' });
    if (db.userByEmail(email)) return reply.code(409).send({ error: 'Email này đã được đăng ký.' });

    const user = db.createUser({ id: crypto.randomUUID(), email, name: typeof name === 'string' ? name.trim().slice(0, 100) : null, passwordHash: hashPassword(password) });
    const key = db.addKey(user.id, newClientKey(), 'server');   // cấp chuỗi mã hoá phiên bản 1 ngay khi đăng ký
    db.touchLogin(user.id);
    const tokens = await issueTokens(user, device);
    log.info(`Đăng ký: ${user.email}`);
    return { user: publicUser(user), ...tokens, encryptionKey: { version: key.version, key: key.key } };
  });

  // ── Đăng nhập / refresh / đăng xuất ─────────────────────────────────────────
  app.post('/api/auth/login', async (req, reply) => {
    if (!limitAuth(`login:${req.ip}`)) return reply.code(429).send({ error: 'Thử quá nhiều lần, hãy đợi ít phút.' });
    const { email, password, device } = req.body ?? {};
    const user = db.userByEmail(email ?? '');
    // Cùng một thông báo cho sai email và sai mật khẩu — không để lộ email nào đã tồn tại.
    if (!user || !verifyPassword(String(password ?? ''), user.password_hash)) return reply.code(401).send({ error: 'Email hoặc mật khẩu không đúng.' });
    if (user.disabled) return reply.code(403).send({ error: 'Tài khoản đã bị khoá.' });
    db.touchLogin(user.id);
    const tokens = await issueTokens(user, device);
    const key = db.currentKey(user.id);
    return { user: publicUser(user), ...tokens, encryptionKey: key ? { version: key.version, key: key.key } : null };
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) return reply.code(400).send({ error: 'Thiếu refreshToken.' });
    const row = db.refreshByHash(sha256(refreshToken));
    if (!row || row.revoked_at || row.expires_at < Date.now()) return reply.code(401).send({ error: 'Phiên đã hết hạn, hãy đăng nhập lại.' });
    const user = db.userById(row.user_id);
    if (!user || user.disabled) return reply.code(401).send({ error: 'Tài khoản không tồn tại hoặc đã bị khoá.' });
    // Xoay vòng: token cũ bị thu hồi, phát token mới — token cũ lọt ra ngoài cũng chỉ dùng được một lần.
    const tokens = await issueTokens(user, row.device);
    db.revokeRefresh(sha256(refreshToken), sha256(tokens.refreshToken).slice(0, 12));
    const key = db.currentKey(user.id);
    return { user: publicUser(user), ...tokens, encryptionKey: key ? { version: key.version, key: key.key } : null };
  });

  app.post('/api/auth/logout', async (req) => {
    const { refreshToken, all } = req.body ?? {};
    if (refreshToken) {
      const row = db.refreshByHash(sha256(refreshToken));
      if (row) { if (all) db.revokeAllRefresh(row.user_id); else db.revokeRefresh(sha256(refreshToken)); }
    }
    return { ok: true };
  });

  // ── Quên mật khẩu ────────────────────────────────────────────────────────────
  app.post('/api/auth/forgot-password', async (req, reply) => {
    if (!limitForgot(`forgot:${req.ip}`)) return reply.code(429).send({ error: 'Thử quá nhiều lần, hãy đợi.' });
    const { email } = req.body ?? {};
    const user = db.userByEmail(email ?? '');
    // Luôn trả cùng một câu — không để lộ email có tồn tại không.
    const generic = { ok: true, message: 'Nếu email tồn tại, mã đặt lại mật khẩu đã được gửi. Mã có hiệu lực ' + config.resetTtlMin + ' phút.', delivery: mailer.configured ? 'email' : 'server-log' };
    if (!user) return generic;
    const code = resetCode();
    db.insertReset(user.id, sha256(code), Date.now() + config.resetTtlMin * 60e3);
    try { await mailer.sendResetCode(user.email, code, config.resetTtlMin); } catch (err) { log.error(`Gửi email đặt lại mật khẩu thất bại: ${err?.message ?? err}`); }
    return generic;
  });

  app.post('/api/auth/reset-password', async (req, reply) => {
    if (!limitAuth(`reset:${req.ip}`)) return reply.code(429).send({ error: 'Thử quá nhiều lần, hãy đợi ít phút.' });
    const { email, code, newPassword } = req.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) return reply.code(400).send({ error: `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.` });
    const user = db.userByEmail(email ?? '');
    if (!user) return reply.code(400).send({ error: 'Mã không đúng hoặc đã hết hạn.' });
    const codeHash = sha256(String(code ?? '').trim().toUpperCase());
    const match = db.activeResets(user.id).find((r) => r.attempts < 5 && r.code_hash === codeHash);
    if (!match) { for (const r of db.activeResets(user.id)) db.bumpResetAttempts(r.id); return reply.code(400).send({ error: 'Mã không đúng hoặc đã hết hạn.' }); }
    db.useReset(match.id);
    db.setPassword(user.id, hashPassword(newPassword));
    db.revokeAllRefresh(user.id);   // mọi thiết bị khác phải đăng nhập lại
    log.info(`Đặt lại mật khẩu: ${user.email}`);
    return { ok: true };
  });

  // ── Hồ sơ / đổi mật khẩu ─────────────────────────────────────────────────────
  app.get('/api/me', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const key = db.currentKey(user.id);
    return { user: publicUser(user), keyVersion: key?.version ?? 0 };
  });

  app.post('/api/me/change-password', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { currentPassword, newPassword } = req.body ?? {};
    if (!verifyPassword(String(currentPassword ?? ''), user.password_hash)) return reply.code(400).send({ error: 'Mật khẩu hiện tại không đúng.' });
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) return reply.code(400).send({ error: `Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự.` });
    db.setPassword(user.id, hashPassword(newPassword));
    return { ok: true };
  });

  // ── Chuỗi mã hoá client ──────────────────────────────────────────────────────
  /** Chuỗi hiện tại + các phiên bản cũ (để thiết bị bỏ lỡ lần đổi vẫn giải mã được dữ liệu cũ rồi mã hoá lại). */
  app.get('/api/keys', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const all = db.allKeys(user.id);
    if (!all.length) { const k = db.addKey(user.id, newClientKey(), 'server'); all.unshift({ version: k.version, key: k.key, source: 'server', created_at: Date.now() }); }
    return { current: { version: all[0].version, key: all[0].key }, versions: all.map((k) => ({ version: k.version, key: k.key, source: k.source, createdAt: k.created_at })) };
  });

  /** Đổi chuỗi: máy chủ sinh chuỗi mới, phiên bản +1. Client phải mã hoá lại toàn bộ dữ liệu cục bộ. */
  app.post('/api/keys/rotate', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const prev = db.currentKey(user.id);
    const k = db.addKey(user.id, newClientKey(), 'server');
    log.info(`Đổi chuỗi mã hoá: ${user.email} → phiên bản ${k.version}`);
    return { current: { version: k.version, key: k.key }, previous: prev ? { version: prev.version, key: prev.key } : null };
  });

  /** Lưu chuỗi do client tự chọn (≥ 32 ký tự) làm phiên bản mới. */
  app.put('/api/keys', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { key } = req.body ?? {};
    if (typeof key !== 'string' || key.trim().length < 32 || key.length > 512) return reply.code(400).send({ error: 'Chuỗi mã hoá cần từ 32 đến 512 ký tự.' });
    const prev = db.currentKey(user.id);
    const k = db.addKey(user.id, key.trim(), 'client');
    return { current: { version: k.version, key: k.key }, previous: prev ? { version: prev.version, key: prev.key } : null };
  });
}
