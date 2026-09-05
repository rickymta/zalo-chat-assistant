/**
 * Báo cáo theo ngày — ghép hai nguồn:
 *  1. Số liệu từ chính CSDL (luôn có): hội thoại có tin trong ngày, số tin mỗi chiều, tin cuối, chưa trả lời…
 *  2. Nội dung tổng hợp do Claude ghi ở <workspace>/ket-qua/bao-cao/YYYY-MM-DD.json (mô tả ở huong-dan/04 mục F);
 *     chưa có thì lấy tạm phần `summary` trong ket-qua/de-xuat.json.
 */
import fs from 'node:fs';
import path from 'node:path';

const VN_TZ = 'Asia/Ho_Chi_Minh';
export const dayKeyVn = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(new Date(ms));
export const dayStartVn = (dateStr) => Date.parse(`${dateStr}T00:00:00+07:00`);

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// Claude đôi khi ghi `relation`/`sentiment` bằng câu chữ thay vì mã — quy về mã để giao diện hiện nhãn ngắn, giữ câu gốc ở relationNote.
const REL_SLUGS = ['khach-hang', 'dong-nghiep', 'doi-tac', 'ban-be', 'nhom', 'khac'];
function normRelation(raw, note, isGroup) {
  if (raw == null || raw === '') return { relation: isGroup ? 'nhom' : null, relationNote: note ?? null };
  const s = String(raw).trim(); const low = s.toLowerCase();
  if (REL_SLUGS.includes(low)) return { relation: low, relationNote: note ?? null };
  const t = low.normalize('NFC').replace(/không\s+(phải|liên quan|là)[^,;.)]*/g, ' ');
  let rel = 'khac';
  if (/đồng nghiệp|nội bộ|cấp trên|cấp dưới|đồng đội|cùng công ty|cùng dự án|dev|nhân viên/.test(t)) rel = 'dong-nghiep';
  else if (/đối tác|nhà cung cấp|đại lý|vendor|agency/.test(t)) rel = 'doi-tac';
  else if (/khách/.test(t)) rel = 'khach-hang';
  else if (/bạn bè|bạn thân|người quen|gia đình|họ hàng/.test(t)) rel = 'ban-be';
  else if (/nhóm|cộng đồng|group/.test(t)) rel = 'nhom';
  return { relation: rel, relationNote: note ?? s };
}
const SENT_ALIAS = [
  ['binh-thuong', /^(binh-thuong|trung-tinh|trung tính|bình thường|neutral|normal)$/],
  ['tich-cuc', /tich-cuc|tích cực|positive|vui|hài lòng/],
  ['khong-hai-long', /khong-hai-long|không hài lòng|tieu-cuc|tiêu cực|bức xúc|khó chịu|phàn nàn|negative/],
  ['lo-lang', /lo-lang|lo lắng|lo âu|băn khoăn|sốt ruột/],
  ['khan', /^khan$|khẩn|gấp|urgent/],
];
function normSentiment(raw) {
  if (raw == null || raw === '') return null;
  const low = String(raw).trim().toLowerCase().normalize('NFC');
  for (const [slug, re] of SENT_ALIAS) if (re.test(low)) return slug;
  return String(raw);
}
function pickClaude(c) {
  const { relation, relationNote } = normRelation(c.relation, c.relationNote, c.kind === 'nhom' || /nh[oó]m/i.test(String(c.type ?? '')));
  const timeline = (Array.isArray(c.timeline) ? c.timeline : []).map((t) => (t && typeof t === 'object') ? { time: t.time ?? t.at ?? '', what: t.what ?? t.text ?? t.event ?? '' } : { time: '', what: String(t ?? '') }).filter((t) => t.what);
  const keyFacts = (Array.isArray(c.keyFacts) ? c.keyFacts : []).map((k) => String(k ?? '')).filter(Boolean);
  return { relation, relationNote, brief: typeof c.brief === 'string' ? c.brief.trim() : '', summary: c.summary ?? '', topics: c.topics ?? [], keyFacts, timeline, decisions: c.decisions ?? [], tasksForYou: c.tasksForYou ?? [], openQuestions: c.openQuestions ?? [], sentiment: normSentiment(c.sentiment), kind: c.kind ?? null, source: c.source };
}
// actionItems: chấp nhận cả kiểu {conversation, priority, file} Claude tự đặt; gắn threadId qua file → tên hội thoại.
function normActionItems(items, conversations, byThread) {
  const byName = new Map(conversations.map((c) => [String(c.name ?? '').trim().toLowerCase(), c]));
  const byFile = new Map(); for (const c of byThread.values()) if (c.file) byFile.set(String(c.file), c);
  return items.map((a) => {
    if (!a || typeof a !== 'object') return null;
    let tid = a.threadId != null ? String(a.threadId) : null;
    const name = a.name ?? a.conversation ?? a.hoiThoai ?? null;
    if (!tid && a.file && byFile.has(String(a.file))) tid = String(byFile.get(String(a.file)).threadId);
    if (!tid && name && byName.has(String(name).trim().toLowerCase())) tid = byName.get(String(name).trim().toLowerCase()).threadId;
    const conv = tid ? conversations.find((c) => c.threadId === tid) : null;
    const task = a.task ?? a.viec ?? a.text ?? a.title ?? '';
    return task ? { threadId: tid, accountId: conv?.accountId ?? a.accountId ?? null, name: name ?? conv?.name ?? '', task: String(task), due: a.due ?? a.han ?? null, priority: a.priority ?? null } : null;
  }).filter(Boolean);
}

const entryCache = { path: null, mtime: 0, byThread: new Map(), date: null, generatedAt: null };
/** Mục tổng hợp của Claude cho MỘT hội thoại — lấy từ bao-cao của hôm nay, không có thì file mới nhất. */
export function claudeEntryFor(root, threadId) {
  const dir = path.join(root, 'ket-qua', 'bao-cao');
  let file = path.join(dir, `${dayKeyVn(Date.now())}.json`);
  if (!fs.existsSync(file)) {
    let latest = null;
    try { latest = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop() ?? null; } catch { /* chưa có */ }
    if (!latest) return null;
    file = path.join(dir, latest);
  }
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (entryCache.path !== file || entryCache.mtime !== st.mtimeMs) {
    const j = readJson(file);
    entryCache.path = file; entryCache.mtime = st.mtimeMs; entryCache.byThread = new Map();
    entryCache.date = j?.date ?? path.basename(file, '.json');
    entryCache.generatedAt = Date.parse(j?.generatedAt ?? '') || st.mtimeMs;
    for (const c of (j?.conversations ?? [])) if (c?.threadId) entryCache.byThread.set(String(c.threadId), c);
  }
  const c = entryCache.byThread.get(String(threadId));
  return c ? { date: entryCache.date, generatedAt: entryCache.generatedAt, ...pickClaude({ ...c, source: 'bao-cao' }) } : null;
}

export function listReportDates(root, db) {
  const dates = new Set();
  const dir = path.join(root, 'ket-qua', 'bao-cao');
  try { for (const f of fs.readdirSync(dir)) { const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (m) dates.add(m[1]); } } catch { /* chưa có */ }
  try { for (const d of db.activeDays(45)) dates.add(d); } catch { /* bỏ qua */ }
  return [...dates].sort().reverse();
}

export function loadReport(root, db, date) {
  const dir = path.join(root, 'ket-qua', 'bao-cao');
  const jsonPath = path.join(dir, `${date}.json`);
  const mdPath = path.join(dir, `${date}.md`);
  const claude = readJson(jsonPath);
  const claudeAt = claude ? (Date.parse(claude.generatedAt ?? '') || fs.statSync(jsonPath).mtimeMs) : null;
  const from = dayStartVn(date), to = from + 86400e3;
  const activity = db.activityByRange(from, to);

  // Gợi ý/tóm tắt tạm từ de-xuat.json khi chưa có báo cáo ngày
  const dx = readJson(path.join(root, 'ket-qua', 'de-xuat.json'));
  const dxItems = Array.isArray(dx) ? dx : (Array.isArray(dx?.items) ? dx.items : []);
  const byThread = new Map();
  for (const c of (claude?.conversations ?? [])) if (c?.threadId) byThread.set(String(c.threadId), { ...c, source: 'bao-cao' });
  for (const it of dxItems) if (it?.threadId && !byThread.has(String(it.threadId))) byThread.set(String(it.threadId), { threadId: String(it.threadId), name: it.name, kind: it.kind, summary: it.summary, source: 'de-xuat' });

  const conversations = activity.rows.map((r) => {
    const c = byThread.get(r.thread_id) ?? null;
    return {
      accountId: r.account_id, threadId: r.thread_id, name: r.name, isGroup: !!r.is_group, avatarUrl: r.avatar_url,
      messages: r.total, inbound: r.inbound, outbound: r.outbound, firstAt: r.first_at, lastAt: r.last_at,
      lastPreview: r.last_message_preview, lastOutbound: r.last_message_outbound === 1, unread: r.unread_count,
      claude: c ? pickClaude(c) : null,
    };
  });
  // Hội thoại Claude có tóm tắt nhưng không có tin trong ngày (báo cáo viết cho gói rộng hơn) — vẫn liệt kê ở cuối
  for (const [tid, c] of byThread) if (c.source === 'bao-cao' && !conversations.some((x) => x.threadId === tid)) conversations.push({ threadId: tid, accountId: c.accountId ?? null, name: c.name, isGroup: c.kind === 'nhom' || /nh[oó]m/i.test(String(c.type ?? '')), messages: 0, inbound: 0, outbound: 0, claude: pickClaude({ ...c, source: 'bao-cao' }) });

  return {
    date,
    hasClaude: !!claude,
    claudeAt,
    mdPath: fs.existsSync(mdPath) ? mdPath : null,
    overview: {
      conversations: activity.rows.length,
      messages: activity.totals.messages,
      inbound: activity.totals.inbound,
      outbound: activity.totals.outbound,
      groups: activity.rows.filter((r) => r.is_group).length,
      needReply: activity.rows.filter((r) => !r.is_group && r.last_message_outbound === 0).length,
      tasksForYou: conversations.reduce((n, c) => n + (c.claude?.tasksForYou?.length ?? 0), 0),
      highlights: claude?.overview?.highlights ?? [],
      claudeSummary: claude?.overview?.summary ?? null,
      claudeBrief: typeof claude?.overview?.brief === 'string' ? claude.overview.brief.trim() : null,
    },
    actionItems: Array.isArray(claude?.actionItems) && claude.actionItems.length
      ? normActionItems(claude.actionItems, conversations, byThread)
      : conversations.flatMap((c) => (c.claude?.tasksForYou ?? []).map((t) => ({ threadId: c.threadId, accountId: c.accountId, name: c.name, task: t, due: null, priority: null }))),
    conversations,
  };
}
