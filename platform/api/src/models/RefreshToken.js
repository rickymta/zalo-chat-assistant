/** Refresh token: chỉ lưu BĂM SHA-256 hex (cùng cách máy chủ cũ) — lộ DB cũng không dùng lại được token. */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    device: { type: String, default: null },
    createdAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true },
    revokedAt: { type: Number, default: null },
    replacedBy: { type: String, default: null },
  },
  { versionKey: false },
);

export const RefreshToken = mongoose.model('RefreshToken', schema, 'refresh_tokens');
