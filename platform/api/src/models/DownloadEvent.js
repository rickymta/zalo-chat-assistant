/**
 * Một lượt tải (chỉ mốc thời gian + id bản phát hành) — dùng cho chỉ số `downloads7d` ở màn thống kê.
 * Bộ đếm tổng nằm ở `Release.downloads`; bảng này chỉ để cắt theo khoảng thời gian.
 * TTL 400 ngày để không phình vô hạn.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    releaseId: { type: String, required: true, index: true },
    at: { type: Number, required: true, index: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 400 },
  },
  { versionKey: false },
);

export const DownloadEvent = mongoose.model('DownloadEvent', schema, 'download_events');
