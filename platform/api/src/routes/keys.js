/**
 * Chuỗi mã hoá client — mục 2 hợp đồng, ứng dụng desktop gọi mỗi lần đăng nhập và mỗi lần đồng bộ.
 * Trả CẢ các phiên bản cũ để thiết bị bỏ lỡ một lần đổi khoá vẫn giải mã được dữ liệu cũ.
 */
import { Router } from 'express';
import { newClientKey } from '../security.js';
import { addKey, currentKey, allKeys, ensureKey } from '../services/keys.js';
import { requireUser } from '../middleware/auth.js';
import { wrap } from '../middleware/errors.js';

export const keysRouter = Router();
keysRouter.use(requireUser);

keysRouter.get('/', wrap(async (req, res) => {
  await ensureKey(req.user._id);   // user cũ chưa có khoá nào (dữ liệu lỗi) vẫn dùng được ngay
  const all = await allKeys(req.user._id);
  res.json({
    current: { version: all[0].version, key: all[0].key },
    versions: all.map((k) => ({ version: k.version, key: k.key, source: k.source, createdAt: k.createdAt })),
  });
}));

/** Máy chủ sinh chuỗi mới, phiên bản +1. Client phải mã hoá lại toàn bộ dữ liệu cục bộ. */
keysRouter.post('/rotate', wrap(async (req, res) => {
  const prev = await currentKey(req.user._id);
  const k = await addKey(req.user._id, newClientKey(), 'server');
  console.log(`[keys] Đổi chuỗi mã hoá: ${req.user.email} → phiên bản ${k.version}`);
  res.json({
    current: { version: k.version, key: k.key },
    previous: prev ? { version: prev.version, key: prev.key } : null,
  });
}));

/** Lưu chuỗi do client tự chọn (32–512 ký tự) làm phiên bản mới. */
keysRouter.put('/', wrap(async (req, res) => {
  const { key } = req.body ?? {};
  if (typeof key !== 'string' || key.trim().length < 32 || key.length > 512) {
    return res.status(400).json({ error: 'Chuỗi mã hoá cần từ 32 đến 512 ký tự.' });
  }
  const prev = await currentKey(req.user._id);
  const k = await addKey(req.user._id, key.trim(), 'client');
  res.json({
    current: { version: k.version, key: k.key },
    previous: prev ? { version: prev.version, key: prev.key } : null,
  });
}));
