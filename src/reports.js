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
  const claudeAt = claude ? (fs.statSync(jsonPath).mtimeMs) : null;
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
      claude: c ? { relation: c.relation ?? null, summary: c.summary ?? '', topics: c.topics ?? [], decisions: c.decisions ?? [], tasksForYou: c.tasksForYou ?? [], openQuestions: c.openQuestions ?? [], sentiment: c.sentiment ?? null, kind: c.kind ?? null, source: c.source } : null,
    };
  });
  // Hội thoại Claude có tóm tắt nhưng không có tin trong ngày (báo cáo viết cho gói rộng hơn) — vẫn liệt kê ở cuối
  for (const [tid, c] of byThread) if (c.source === 'bao-cao' && !conversations.some((x) => x.threadId === tid)) conversations.push({ threadId: tid, accountId: c.accountId ?? null, name: c.name, isGroup: c.kind === 'nhom', messages: 0, inbound: 0, outbound: 0, claude: { relation: c.relation ?? null, summary: c.summary ?? '', topics: c.topics ?? [], decisions: c.decisions ?? [], tasksForYou: c.tasksForYou ?? [], openQuestions: c.openQuestions ?? [], sentiment: c.sentiment ?? null, kind: c.kind ?? null, source: 'bao-cao' } });

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
    },
    actionItems: Array.isArray(claude?.actionItems) ? claude.actionItems : conversations.flatMap((c) => (c.claude?.tasksForYou ?? []).map((t) => ({ threadId: c.threadId, name: c.name, task: t }))),
    conversations,
  };
}
