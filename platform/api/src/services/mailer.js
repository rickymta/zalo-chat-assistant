/** Gửi email qua SMTP nếu cấu hình; không có SMTP thì GHI MÃ RA LOG để quản trị viên chuyển cho người dùng. */
import nodemailer from 'nodemailer';
import { config } from '../config.js';

function makeMailer() {
  if (!config.smtp) {
    console.warn('[mail] Chưa cấu hình SMTP — mã đặt lại mật khẩu sẽ được GHI RA LOG máy chủ thay vì gửi email.');
    return {
      configured: false,
      async sendResetCode(email, code, ttlMin) {
        console.warn(`[RESET-CODE] ${email} → mã: ${code} (hết hạn sau ${ttlMin} phút)`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return {
    configured: true,
    async sendResetCode(email, code, ttlMin) {
      await transport.sendMail({
        from: config.smtp.from,
        to: email,
        subject: `${config.appName} — mã đặt lại mật khẩu`,
        text: `Mã đặt lại mật khẩu của bạn là: ${code}\n\nMã có hiệu lực ${ttlMin} phút. Nhập mã này cùng mật khẩu mới trong ứng dụng ${config.appName}.\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      });
    },
  };
}

export const mailer = makeMailer();
