/**
 * Chuỗi mã hoá client theo phiên bản.
 *
 * SQLite cũ tăng version trong một transaction; MongoDB không có transaction trên bản một nút, nên chốt
 * an toàn ở đây là CHỈ MỤC DUY NHẤT (userId, version): hai yêu cầu đổi khoá song song thì một cái nhận
 * lỗi trùng khoá E11000 và thử lại với version kế tiếp. Không có chỉ mục đó, hai thiết bị bấm cùng lúc
 * sẽ tạo hai khoá KHÁC NHAU cùng version — dữ liệu mã hoá bằng khoá thua cuộc thành không đọc được.
 */
import { ClientKey } from '../models/ClientKey.js';
import { newClientKey } from '../security.js';

export async function currentKey(userId) {
  return ClientKey.findOne({ userId }).sort({ version: -1 }).lean();
}

export async function allKeys(userId) {
  return ClientKey.find({ userId }).sort({ version: -1 }).lean();
}

/** Thêm phiên bản khoá mới (version = hiện tại + 1), có thử lại khi đụng độ. */
export async function addKey(userId, key, source = 'server') {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cur = await currentKey(userId);
    const version = (cur?.version ?? 0) + 1;
    try {
      const doc = await ClientKey.create({ userId, version, key, source, createdAt: Date.now() });
      return { version: doc.version, key: doc.key, source: doc.source, createdAt: doc.createdAt };
    } catch (err) {
      if (err?.code !== 11000) throw err;   // trùng (userId, version) ⇒ có ai đó vừa chen ngang, thử lại
    }
  }
  throw Object.assign(new Error('Không cấp được chuỗi mã hoá mới, hãy thử lại.'), { status: 503 });
}

/** Mỗi user luôn phải có ≥ 1 khoá — gọi khi đăng ký, khi migrate, và khi /api/keys thấy trống. */
export async function ensureKey(userId) {
  const cur = await currentKey(userId);
  if (cur) return cur;
  return addKey(userId, newClientKey(), 'server');
}
