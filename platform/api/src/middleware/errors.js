/** Bọc handler async, 404 và bộ xử lý lỗi cuối cùng. Mọi lỗi ra ngoài đều là JSON tiếng Việt. */

/** Bọc một handler async để lỗi promise không bị "nuốt" mà đi vào errorHandler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Lỗi có mã HTTP chủ đích (ném từ trong service). */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Không tìm thấy.', code: 'NOT_FOUND' });
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;
  // Lỗi trùng khoá của Mongo — thường là email/slug đã tồn tại.
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'Dữ liệu đã tồn tại (trùng khoá).', code: 'DUPLICATE' });
  }
  if (err?.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Tệp vượt quá dung lượng cho phép.' : `Tải tệp lên thất bại: ${err.message}`;
    return res.status(400).json({ error: msg, code: err.code });
  }
  if (status >= 500) console.error(`[lỗi] ${err?.stack ?? err}`);
  res.status(status).json({ error: status >= 500 ? 'Lỗi máy chủ.' : err.message, ...(err.code ? { code: err.code } : {}) });
}
