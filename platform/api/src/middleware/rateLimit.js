/**
 * Giới hạn tần suất theo IP + nhóm, cửa sổ trượt trong bộ nhớ tiến trình.
 * Đủ cho công cụ nội bộ một bản chạy; chạy nhiều bản thì mỗi bản có bộ đếm riêng — chấp nhận được,
 * nhưng đừng coi đây là hàng rào chống DDoS.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 10, group = 'default' } = {}) {
  return (req, res, next) => {
    const key = `${group}:${req.ip}`;
    const now = Date.now();
    const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    buckets.set(key, arr);
    // Dọn rác định kỳ để Map không phình theo số IP đã từng gọi.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
    }
    if (arr.length > max) {
      return res.status(429).json({ error: 'Thử quá nhiều lần, hãy đợi ít phút.', code: 'RATE_LIMIT' });
    }
    next();
  };
}

/** Chỉ dùng trong kiểm thử: xoá sạch bộ đếm. */
export function resetRateLimit() { buckets.clear(); }
