/** Tiện ích dùng chung cho các bộ xuất. */
import fs from 'node:fs';
import path from 'node:path';

const VN_TZ = 'Asia/Ho_Chi_Minh';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** epoch ms → "dd/MM/yyyy HH:mm:ss" theo giờ Việt Nam. */
export function formatVn(ms) {
  if (ms === null || ms === undefined) return '';
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(Number(ms))).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

/** epoch ms → "dd/MM/yyyy" theo giờ Việt Nam. */
export function formatVnDate(ms) {
  return formatVn(ms).slice(0, 10);
}

/** Dấu thời gian cho tên thư mục/file: yyyyMMdd-HHmmss theo giờ VN. */
export function stampVn(ms = Date.now()) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour === '24' ? '00' : p.hour}${p.minute}${p.second}`;
}

/** Bỏ dấu tiếng Việt, hạ thường, giữ chữ-số-gạch — dùng cho tên file. */
export function slugify(s, max = 60) {
  const base = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'hoi-thoai').slice(0, max).replace(/-+$/g, '');
}

/**
 * Tên sheet Excel: ≤ 31 ký tự, cấm \ / ? * [ ] : và không được trùng trong workbook.
 * Giữ nguyên tiếng Việt có dấu (Excel hỗ trợ), chỉ cắt và khử trùng.
 */
export function uniqueSheetName(name, used) {
  let base = String(name ?? 'Hội thoại').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = 'Hội thoại';
  if (base.startsWith("'")) base = base.slice(1);
  base = base.slice(0, 31).trim();
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length).trimEnd() + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Chọn hội thoại theo bộ lọc xuất — dùng chung cho Excel và Markdown để hai gói luôn khớp nhau. */
export function resolveSelection(db, params) {
  return db.selectConversationsForExport({
    accountIds: params.accountIds,
    from: params.from ?? null,
    to: params.to ?? null,
    includeGroups: !!params.includeGroups,
    onlyWaiting: !!params.onlyWaiting,
    threadIds: params.threadIds,
    q: params.q,
  });
}

export function accountsMap(db) {
  return Object.fromEntries(db.listAccounts().map((a) => [a.id, a]));
}

export function parseAttachments(json) {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

/** Số giờ đã chờ kể từ tin cuối của khách (0 nếu tin cuối là của mình). */
export function waitingHoursOf(conv, now = Date.now()) {
  if (!conv || conv.last_message_outbound !== 0 || !conv.last_message_at) return 0;
  return Math.max(0, (now - conv.last_message_at) / 3600000);
}
