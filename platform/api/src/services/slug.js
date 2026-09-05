/** Sinh slug tiếng Việt không dấu: "Bản 1.2 — Có gì mới?" → "ban-1-2-co-gi-moi". */
export function slugify(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu mũ
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'bai-viet';
}

/** Slug duy nhất: thêm hậu tố -2, -3… nếu đã có bài khác dùng slug đó. */
export async function uniqueSlug(Model, base, excludeId = null) {
  const root = slugify(base);
  for (let i = 0; i < 200; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const found = await Model.findOne({ slug: candidate }).select('_id').lean();
    if (!found || found._id === excludeId) return candidate;
  }
  return `${root}-${Date.now()}`;
}
