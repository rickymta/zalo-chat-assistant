/**
 * Chuỗi mã hoá cấp cho client, theo phiên bản tăng dần. Giữ CẢ phiên bản cũ để thiết bị bỏ lỡ một
 * lần đổi khoá vẫn giải mã được dữ liệu cũ rồi mã hoá lại.
 * Khoá duy nhất (userId, version) chính là hàng rào chống hai yêu cầu đổi khoá song song cùng ra một version.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    key: { type: String, required: true },
    source: { type: String, enum: ['server', 'client'], default: 'server' },
    createdAt: { type: Number, required: true },
  },
  { versionKey: false },
);

schema.index({ userId: 1, version: 1 }, { unique: true });

export const ClientKey = mongoose.model('ClientKey', schema, 'client_keys');
