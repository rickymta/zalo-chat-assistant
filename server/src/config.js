/** Cấu hình máy chủ — đọc từ biến môi trường. Thiếu JWT_SECRET là DỪNG (fail-fast). */
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4789),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? './data',
  jwtSecret: required('JWT_SECRET'),
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC ?? 900),          // 15 phút
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  resetTtlMin: Number(process.env.RESET_TTL_MIN ?? 30),
  /** Mã đăng ký chung (tuỳ chọn): đặt để chỉ người trong công ty đăng ký được. */
  registrationCode: process.env.REGISTRATION_CODE || null,
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
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
