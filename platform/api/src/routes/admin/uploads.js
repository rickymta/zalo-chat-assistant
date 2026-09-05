/** Tải ảnh cho CMS: chỉ ảnh, ≤ 10 MB, trả về đường dẫn `/uploads/<tên>` để nhúng vào bài viết. */
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { wrap } from '../../middleware/errors.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']);

const storage = multer.diskStorage({
  destination(_req, _file, cb) { cb(null, config.uploadsDir); },
  filename(_req, file, cb) {
    // Tên ngẫu nhiên + phần mở rộng gốc: tránh đè tệp cũ và tránh tên do người dùng đặt lọt vào đường dẫn.
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '').slice(0, 10) || '.bin';
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) return cb(Object.assign(new Error('Chỉ nhận tệp ảnh (jpeg, png, gif, webp, svg, avif).'), { status: 400 }));
    cb(null, true);
  },
});

export const adminUploadsRouter = Router();

adminUploadsRouter.post('/', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Thiếu tệp tải lên (trường `file`).' });
  res.json({ url: `/uploads/${req.file.filename}`, fileName: req.file.filename, size: req.file.size });
}));
