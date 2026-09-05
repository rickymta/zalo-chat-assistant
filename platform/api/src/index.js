/**
 * Điểm khởi động API nền tảng Zalo Chat Assistant.
 * Thứ tự bắt buộc: nạp cấu hình (fail-fast) → tạo thư mục dữ liệu → nối MongoDB → mới mở cổng.
 * Mở cổng trước khi có DB sẽ trả 500 hàng loạt trong vài giây đầu và làm health check hiểu nhầm là "sống".
 */
import { config, ensureDirs } from './config.js';
import { connectDb, closeDb } from './db.js';
import { createApp } from './app.js';
import { mailer } from './services/mailer.js';

ensureDirs();
await connectDb();
console.log(`[khởi động] Đã nối MongoDB: ${config.mongoUrl.replace(/\/\/[^@]*@/, '//***@')}`);

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(
    `[khởi động] API sẵn sàng tại http://${config.host}:${config.port} — `
    + `đăng ký ${config.allowRegistration ? (config.registrationCode ? 'cần mã' : 'mở') : 'ĐÓNG'}, `
    + `SMTP ${mailer.configured ? 'có' : 'không (mã reset ghi ra log)'}, `
    + `admin bootstrap: ${config.adminEmails.length ? config.adminEmails.join(', ') : '(chưa đặt)'}`,
  );
});

// Tải tệp 600 MB qua đường truyền chậm có thể lâu hơn mặc định 5 phút của Node.
server.requestTimeout = 30 * 60e3;
server.headersTimeout = 65e3;

const shutdown = async (signal) => {
  console.log(`[dừng] Nhận ${signal}, đang đóng...`);
  server.close();
  try { await closeDb(); } finally { process.exit(0); }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
