/**
 * Người dùng. `_id` là UUID CHUỖI giữ nguyên từ máy chủ cũ — ứng dụng desktop dẫn xuất khoá mã hoá
 * từ `user.id` (HKDF salt), đổi id là người dùng mất khả năng đọc dữ liệu đã mã hoá trên máy họ.
 * Mốc thời gian lưu epoch ms (số) giống SQLite cũ, KHÔNG dùng Date của Mongoose.
 */
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: null },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    disabled: { type: Boolean, default: false },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
    lastLoginAt: { type: Number, default: null },
  },
  { versionKey: false, _id: false },
);

/** Hình dạng `user` trong mọi phản hồi API (hợp đồng mục 1). */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    email: this.email,
    name: this.name ?? null,
    role: this.role ?? 'user',
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt ?? null,
  };
};

export const User = mongoose.model('User', userSchema, 'users');
