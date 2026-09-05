/** Mã đặt lại mật khẩu: băm SHA-256 hex, hạn RESET_TTL_MIN, tối đa 5 lần thử sai. */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    createdAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true },
    usedAt: { type: Number, default: null },
    attempts: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const ResetCode = mongoose.model('ResetCode', schema, 'reset_codes');
