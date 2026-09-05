/**
 * Cấu hình API nền tảng — đọc từ biến môi trường.
 * Thiếu JWT_SECRET hoặc MONGO_URL là DỪNG NGAY (fail-fast) — chạy tiếp chỉ tạo ra lỗi khó hiểu về sau.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`[cấu hình] Thiếu biến môi trường bắt buộc: ${name}`);
    process.exit(1);
  }
  return String(v).trim();
}

function list(name, fallback = '') {
  return String(process.env[name] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4789),
  host: process.env.HOST ?? '0.0.0.0',
  version: readVersion(),

  jwtSecret: required('JWT_SECRET'),
  mongoUrl: required('MONGO_URL'),

  accessTtlSec: Number(process.env.ACCESS_TTL_SEC ?? 900), // 15 phút
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  resetTtlMin: Number(process.env.RESET_TTL_MIN ?? 30),

  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
  /** Mã đăng ký chung (tuỳ chọn): đặt để chỉ người trong công ty đăng ký được. */
  registrationCode: process.env.REGISTRATION_CODE || null,
  /** Email trong danh sách này được nâng lên quyền admin khi đăng nhập / khi migrate. */
  adminEmails: list('ADMIN_EMAILS').map((e) => e.toLowerCase()),

  /** Gốc URL công khai để dựng downloadUrl (thường là địa chỉ của web, nginx proxy /downloads sang api). */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:4790').replace(/\/+$/, ''),
  releasesDir: process.env.RELEASES_DIR ?? '/data/releases',
  uploadsDir: process.env.UPLOADS_DIR ?? '/data/uploads',

  corsOrigins: list('CORS_ORIGINS', 'http://localhost:4790,http://localhost:5174'),

  appName: process.env.APP_NAME ?? 'Zalo Chat Assistant',

  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      }
    : null,
};

/** Tạo sẵn thư mục lưu file — thiếu quyền ghi thì biết ngay lúc khởi động chứ không phải lúc người dùng tải lên. */
export function ensureDirs() {
  for (const dir of [config.releasesDir, config.uploadsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
