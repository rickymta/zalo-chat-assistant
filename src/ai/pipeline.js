/**
 * Pipeline tổng hợp bằng AI cục bộ — thay lịch Claude Cowork: đọc gói du-lieu/ (đúng các file Markdown Cowork đang đọc),
 * tóm tắt TUẦN TỰ từng hội thoại bằng model trong ứng dụng, rồi ghi ket-qua/ y như Cowork:
 *   ket-qua/de-xuat.json            (huong-dan/04 mục E — giao diện hiện gợi ý trong hội thoại)
 *   ket-qua/bao-cao/YYYY-MM-DD.json (+ .md) (mục F — hộp "Báo cáo ngày")
 *   ket-qua/YYYY-MM-DD-tong-hop.md  (bản người đọc)
 * Hội thoại không đổi (cùng số tin, cùng tin cuối) dùng lại kết quả lần trước — trạng thái ở ket-qua/.ai-cuc-bo.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { workspaceLayout } from '../workspace.js';
import { dayKeyVn } from '../reports.js';
import { CLASSIFY_SCHEMA, SUMMARY_SCHEMA, OVERVIEW_SCHEMA, SYSTEM_CLASSIFY, SYSTEM_SUMMARY_INTERNAL, SYSTEM_SUMMARY_CUSTOMER, SYSTEM_OVERVIEW, conversationPrompt, summaryPrompt, overviewPrompt, RELATIONS, SENTIMENTS, KINDS } from './prompts.js';

const OUTPUT_TOKENS = 1800;
const RETRY_TOKENS = 2600;
const MARGIN_TOKENS = 220;

function isoVn(ms = Date.now()) {
  const d = new Date(ms + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+07:00`;
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const clean = (v) => String(v ?? '').trim();
const cleanList = (v, max = 12) => (Array.isArray(v) ? v : []).map((x) => clean(typeof x === 'object' ? (x?.what ?? x?.text ?? '') : x)).filter(Boolean).slice(0, max);

/** Đọc phần đầu file hội thoại do export/markdown.js ghi. */
export function parseConversationFile(text) {
  const m = {
    name: /^# Hội thoại: (.*)$/m.exec(text)?.[1]?.trim() ?? '(chưa rõ tên)',
    isGroup: /- Loại: Nhóm/.test(text),
    threadId: /Mã thread: `([^`]+)`/.exec(text)?.[1] ?? null,
    accountId: /Mã tài khoản: `([^`]+)`/.exec(text)?.[1] ?? null,
    phone: /^- SĐT khách: (.*)$/m.exec(text)?.[1]?.trim() ?? '',
    total: Number(/^- Số tin trong gói: (\d+)/m.exec(text)?.[1] ?? 0),
    inbound: Number(/\((?:thành viên|người kia) (\d+) \/ mình (\d+)\)/.exec(text)?.[1] ?? 0),
    outbound: Number(/\((?:thành viên|người kia) (\d+) \/ mình (\d+)\)/.exec(text)?.[2] ?? 0),
    lastAtText: /^- Tin cuối: (.+?) do (.+?) gửi/m.exec(text)?.[1] ?? '',
    lastBy: /^- Tin cuối: (.+?) do (.+?) gửi/m.exec(text)?.[2] ?? '',
    waiting: /\*\*Trạng thái: CHƯA TRẢ LỜI\*\*/.test(text),
    waitingHours: Number(/đã ([\d.]+) giờ/.exec(text)?.[1] ?? 0),
    overdue: /QUÁ HẠN/.test(text),
  };
  const idx = text.indexOf('## Tin nhắn');
  const body = idx >= 0 ? text.slice(text.indexOf('\n', idx) + 1) : '';
  m.messages = body.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  m.fingerprint = `${m.total}|${m.lastAtText}|${m.lastBy}|${m.messages.length}`;
  return m;
}

function normalizeEntry(raw, meta) {
  const e = raw && typeof raw === 'object' ? raw : {};
  let kind = KINDS.includes(e.kind) ? e.kind : (meta.isGroup ? 'nhom' : (meta.waiting ? 'tra-loi' : 'theo-doi'));
  if (meta.isGroup && (kind === 'tra-loi' || kind === 'theo-doi')) kind = 'nhom';
  if (!meta.isGroup && kind === 'nhom') kind = meta.waiting ? 'tra-loi' : 'theo-doi';
  let reply = clean(e.reply).replace(/\r/g, '');
  if (kind !== 'khong-can' && !reply) kind = 'khong-can';
  if (kind === 'khong-can') reply = '';
  const priority = kind === 'khong-can' ? null : (['P1', 'P2', 'P3'].includes(e.priority) ? e.priority : (kind === 'theo-doi' ? 'P3' : 'P2'));
  const relation = RELATIONS.includes(e.relation) ? e.relation : (meta.isGroup ? 'nhom' : 'khac');
  const timeline = (Array.isArray(e.timeline) ? e.timeline : []).map((t) => ({ time: clean(t?.time), what: clean(t?.what) })).filter((t) => t.what).slice(0, 10);
  return {
    threadId: meta.threadId, accountId: meta.accountId, name: meta.name, file: meta.file,
    relation, relationNote: clean(e.relationNote) || null,
    brief: clean(e.brief) || clean(e.summary).split(/(?<=[.!?])\s/)[0] || '',
    summary: clean(e.summary), topics: cleanList(e.topics, 8), timeline, keyFacts: cleanList(e.keyFacts, 10),
    decisions: cleanList(e.decisions, 8), tasksForYou: cleanList(e.tasksForYou, 8), openQuestions: cleanList(e.openQuestions, 8),
    sentiment: SENTIMENTS.includes(e.sentiment) ? e.sentiment : 'binh-thuong',
    kind, priority, reply, reason: kind === 'khong-can' ? (clean(e.reason) || 'Không cần nhắn lúc này.') : clean(e.reason),
    notes: clean(e.notes), nextAction: clean(e.nextAction),
  };
}

const PRIO_ORDER = { P1: 0, P2: 1, P3: 2 };

function renderReportMd(report) {
  const L = [`# Báo cáo ngày ${report.date}`, '', `*Tổng hợp bởi AI cục bộ lúc ${report.generatedAt}.*`, '', '## Tổng quan', '', report.overview.brief, '', report.overview.summary, ''];
  if (report.overview.highlights?.length) { L.push('## Điểm nổi bật', ''); for (const h of report.overview.highlights) L.push(`- ${h}`); L.push(''); }
  if (report.actionItems?.length) { L.push('## Việc cần làm', ''); for (const a of report.actionItems) L.push(`- ${a.priority ? `[${a.priority}] ` : ''}${a.name}: ${a.task}`); L.push(''); }
  L.push('## Từng hội thoại', '');
  for (const c of report.conversations) {
    L.push(`### ${c.name} — ${c.relation}${c.kind ? ` · ${c.kind}` : ''}`, '', c.brief || c.summary, '');
    if (c.summary && c.summary !== c.brief) L.push(c.summary, '');
    if (c.timeline?.length) { for (const t of c.timeline) L.push(`- ${t.time ? `${t.time} — ` : ''}${t.what}`); L.push(''); }
    if (c.keyFacts?.length) L.push(`Thông tin đáng lưu: ${c.keyFacts.join(' · ')}`, '');
    if (c.tasksForYou?.length) L.push(`Việc của Bạn: ${c.tasksForYou.join('; ')}`, '');
    if (c.openQuestions?.length) L.push(`Câu hỏi treo: ${c.openQuestions.join('; ')}`, '');
  }
  return L.join('\n');
}

function renderTongHopMd(date, entries) {
  const L = [`# Tổng hợp & đề xuất phản hồi — ${date}`, '', '*Do AI cục bộ trong ứng dụng tạo. Tư vấn viên đọc, sửa rồi tự gửi.*', '', '## A. Bảng ưu tiên', '', '| Ưu tiên | Hội thoại | Loại | Tóm tắt |', '|---|---|---|---|'];
  const sorted = entries.slice().sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9));
  for (const e of sorted) L.push(`| ${e.priority ?? '—'} | ${e.name} | ${e.kind} | ${e.brief.replace(/\|/g, '/')} |`);
  L.push('', '## B. Phiếu từng hội thoại', '');
  for (const e of sorted) {
    L.push(`## [${e.priority ?? 'không cần'}] ${e.name} — ${e.file}`, '', `**Tóm tắt:** ${e.summary || e.brief}`, '');
    if (e.kind === 'khong-can') L.push(`**Không cần nhắn:** ${e.reason}`, '');
    else { L.push('**Đề xuất phản hồi:**', '', ...e.reply.split('\n').map((l) => `> ${l}`), ''); if (e.notes) L.push(`**Ghi chú:** ${e.notes}`, ''); if (e.nextAction) L.push(`**Việc tiếp theo:** ${e.nextAction}`, ''); }
  }
  return L.join('\n');
}

export function createLocalPipeline({ engine, root, log, settings, events }) {
  const L = workspaceLayout(root);
  const stateFile = path.join(L.resultsDir, '.ai-cuc-bo.json');
  const st = { running: false, phase: 'idle', current: null, total: 0, done: 0, reused: 0, lastRunAt: null, lastDurationMs: null, lastError: null, lastResult: null, startedAt: null };
  const emit = () => { try { events?.emit('ai', { pipeline: status(), ...engine.status() }); } catch { /* bỏ qua */ } };
  const status = () => ({ ...st, current: st.current ? { ...st.current } : null });

  function loadPrev() { return readJson(stateFile) ?? { entries: {} }; }
  function savePrev(prev) { try { fs.writeFileSync(stateFile, JSON.stringify(prev)); } catch { /* bỏ qua */ } }

  /** Nén một dòng tin của export/markdown.js: "**[dd/MM/yyyy HH:mm:ss] Tên:** nội dung" → { day, text: "HH:MM Tên: nội dung" }. */
  function compactLine(line) {
    const m = /^(?:- )?\*\*\[(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}):\d{2}\] ([^*]+?):\*\* ?([\s\S]*)$/.exec(line);
    // Liên kết ảnh/tệp/sticker chỉ tốn token, model không mở được ⇒ giữ nhãn, bỏ URL.
    let body = (m ? m[4] : line.replace(/\*\*/g, '')).replace(/\[([^\]]{1,40})\]\((https?:\/\/[^)\s]+)\)/g, '[$1]').replace(/https?:\/\/\S{60,}/g, '[liên kết]');
    // Danh thiếp Zalo được chia sẻ dưới dạng JSON thô ({"phone":…,"qrCodeUrl":…}) — model 3B dễ lặp vô hạn khi thấy JSON; đổi thành một câu.
    body = body.replace(/^(.*?)\s*—\s*\{"phone":"([^"]*)"[^}]*\}.*$/s, (_all, name, phone) => `[Danh thiếp Zalo: ${name.trim() || 'không rõ tên'} — ${phone}]`).replace(/\{[^{}]{0,400}"qrCodeUrl"[^{}]*\}/g, '[danh thiếp]');
    if (!m) return { day: null, text: body };
    return { day: m[1], text: `${m[2]} ${m[3]}: ${body}`.trim() };
  }

  /** Cắt bớt tin cũ cho vừa ngữ cảnh: giữ phần MỚI nhất, chèn dòng "— dd/MM/yyyy —" khi đổi ngày. */
  function fitTranscript(meta, budget) {
    const items = meta.messages.map(compactLine);
    let used = 0; let start = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      const t = engine.tokenCount(items[i].text) + 1;
      if (used + t > budget) break;
      used += t; start = i;
    }
    const out = []; let day = null;
    for (let i = start; i < items.length; i++) {
      if (items[i].day && items[i].day !== day) { day = items[i].day; out.push(`— ${day} —`); }
      out.push(items[i].text);
    }
    return { transcript: out.join('\n'), truncatedCount: start };
  }

  /** Gọi model theo schema; đầu ra bị cắt ở giới hạn token thì thử lại một lần với giới hạn cao hơn và yêu cầu ngắn gọn. */
  async function generateWithRetry({ system, user, schema, maxTokens, temperature }) {
    try {
      return await engine.generateJson({ system, user, schema, maxTokens, temperature });
    } catch (err) {
      if (!/JSON|Unterminated|Unexpected end/i.test(String(err?.message))) throw err;
      log?.warn(`AI cục bộ: đầu ra bị cắt (${err.message}) — thử lại với giới hạn ${RETRY_TOKENS} token.`);
      return engine.generateJson({ system, user: user + '\n\nLƯU Ý: viết ngắn gọn hơn — mỗi mảng tối đa 6 mục, summary tối đa 8 câu.', schema, maxTokens: RETRY_TOKENS, temperature: 0.1 });
    }
  }

  async function run({ reason = 'auto', force = false } = {}) {
    if (st.running) return status();
    if ((settings.load().aiEngine ?? 'local') === 'cowork') return status();
    const info = readJson(path.join(L.dataDir, '.trang-thai.json'));
    if (!info) { st.lastError = 'Chưa có gói dữ liệu du-lieu/ — bấm "Cập nhật dữ liệu" trước.'; emit(); return status(); }
    let files = [];
    try { files = fs.readdirSync(path.join(L.dataDir, 'hoi-thoai')).filter((f) => f.endsWith('.md')).sort(); } catch { files = []; }
    if (!files.length) { st.lastError = 'Gói dữ liệu không có hội thoại.'; emit(); return status(); }

    st.running = true; st.phase = 'loading'; st.lastError = null; st.done = 0; st.reused = 0; st.total = files.length; st.startedAt = Date.now(); st.current = null; emit();
    const t0 = Date.now();
    try {
      await engine.load();
      const systemTokens = Math.max(engine.tokenCount(SYSTEM_SUMMARY_CUSTOMER), engine.tokenCount(SYSTEM_CLASSIFY));
      const budget = Math.max(1200, (engine.state.contextSize || 8192) - systemTokens - OUTPUT_TOKENS - MARGIN_TOKENS - 260);
      const prev = force ? { entries: {} } : loadPrev();
      const gaps = Array.isArray(info.gaps) ? info.gaps : [];
      const metas = files.map((f) => { const text = fs.readFileSync(path.join(L.dataDir, 'hoi-thoai', f), 'utf8'); return { ...parseConversationFile(text), file: `du-lieu/hoi-thoai/${f}`, gaps }; }).filter((m) => m.threadId && m.total > 0);
      // Hội thoại đang chờ / quá hạn lên trước; còn lại theo tin cuối mới nhất (thứ tự file đã theo lựa chọn xuất).
      metas.sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || (Number(b.waiting) - Number(a.waiting)));
      st.total = metas.length;
      const entries = []; const nextPrev = { entries: {} };
      st.phase = 'conversations';
      for (const meta of metas) {
        st.current = { name: meta.name, index: entries.length + 1, total: metas.length }; emit();
        const old = prev.entries?.[meta.threadId];
        if (old && old.fingerprint === meta.fingerprint && old.entry?.brief && old.entry?.summary) {
          entries.push({ ...old.entry, file: meta.file, name: meta.name }); nextPrev.entries[meta.threadId] = old; st.reused += 1; st.done += 1; continue;
        }
        const { transcript, truncatedCount } = fitTranscript(meta, budget);
        let entry;
        try {
          // Bước A: phân loại bằng prompt trung tính (không có nội dung CSKH ⇒ đồng nghiệp không bị gán thành khách).
          const cls = await generateWithRetry({ system: SYSTEM_CLASSIFY, user: conversationPrompt({ meta, transcript, truncatedCount }), schema: CLASSIFY_SCHEMA, maxTokens: 400, temperature: 0.1 });
          const pre = normalizeEntry({ ...cls, summary: cls.brief, reply: cls.kind === 'khong-can' ? '' : 'x' }, meta);   // chuẩn hoá quan hệ/loại/ưu tiên theo luật nhóm/1-1
          const clsFixed = { relation: pre.relation, relationNote: pre.relationNote, kind: pre.kind, priority: pre.priority, sentiment: pre.sentiment, brief: pre.brief };
          if (clsFixed.kind === 'khong-can' && meta.total <= 3) {
            // Hội thoại rất ngắn, không cần nhắn (danh thiếp, cảm ơn, sticker…): không tốn một lượt model nữa.
            const tl = meta.messages.map(compactLine).filter((l) => l.day).slice(-3).map((l) => ({ time: l.text.slice(0, 5), what: l.text.slice(6, 166) }));
            entry = normalizeEntry({ ...clsFixed, summary: clsFixed.brief, timeline: tl, reason: cls.reason || 'Hội thoại ngắn, không có yêu cầu nào cho Bạn.', priority: 'none' }, meta);
          } else {
            // Bước B: tóm tắt + đề xuất với prompt riêng theo quan hệ.
            const system = clsFixed.relation === 'khach-hang' ? SYSTEM_SUMMARY_CUSTOMER : SYSTEM_SUMMARY_INTERNAL;
            const det = await generateWithRetry({ system, user: summaryPrompt({ meta, transcript, truncatedCount, cls: clsFixed }), schema: SUMMARY_SCHEMA, maxTokens: OUTPUT_TOKENS, temperature: 0.2 });
            entry = normalizeEntry({ ...det, ...clsFixed, priority: clsFixed.priority ?? 'none' }, meta);
          }
        } catch (err) {
          log?.warn(`AI cục bộ: hội thoại "${meta.name}" lỗi: ${err?.message ?? err}`);
          entry = normalizeEntry({ brief: 'Không tổng hợp được hội thoại này (lỗi model).', summary: 'Không tổng hợp được hội thoại này (lỗi model).', kind: 'khong-can', reason: 'Lỗi khi tổng hợp — thử lại lần sau.' }, meta);
        }
        entries.push(entry);
        nextPrev.entries[meta.threadId] = { fingerprint: meta.fingerprint, entry, at: Date.now() };
        st.done += 1; emit();
      }

      // Tổng quan ngày
      st.phase = 'overview'; st.current = null; emit();
      const date = dayKeyVn(Date.now());
      const dateText = date.split('-').reverse().join('/');
      const rows = entries.map((e) => { const m = metas.find((x) => x.threadId === e.threadId); return { name: e.name, relation: e.relation, kind: e.kind, priority: e.priority, brief: e.brief, tasksForYou: e.tasksForYou, openQuestions: e.openQuestions, waiting: !!m?.waiting }; });
      let overview;
      try {
        const o = await generateWithRetry({ system: SYSTEM_OVERVIEW, user: overviewPrompt({ dateText, rows, gaps }), schema: OVERVIEW_SCHEMA, maxTokens: 1600, temperature: 0.3 });
        overview = { brief: clean(o.brief), summary: clean(o.summary), highlights: cleanList(o.highlights, 8) };
      } catch (err) {
        log?.warn(`AI cục bộ: tổng quan lỗi: ${err?.message ?? err}`);
        overview = { brief: `Ngày ${dateText} có ${entries.length} hội thoại có tin.`, summary: entries.map((e) => `${e.name}: ${e.brief}`).join('\n\n'), highlights: entries.filter((e) => e.priority === 'P1' || e.priority === 'P2').slice(0, 6).map((e) => `${e.name}: ${e.brief}`) };
      }
      if (!overview.brief) overview.brief = `Ngày ${dateText} có ${entries.length} hội thoại có tin.`;
      const actionItems = entries.flatMap((e) => e.tasksForYou.map((task) => ({ threadId: e.threadId, accountId: e.accountId, name: e.name, task, priority: e.priority ?? 'P3' }))).sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9));

      // Ghi kết quả — đúng định dạng Cowork
      st.phase = 'writing'; emit();
      const now = isoVn();
      fs.mkdirSync(path.join(L.resultsDir, 'bao-cao'), { recursive: true });
      const deXuat = { createdAt: now, engine: 'local', model: engine.state.modelName, items: entries.map((e) => ({ threadId: e.threadId, accountId: e.accountId, name: e.name, kind: e.kind, priority: e.priority, summary: e.brief, reply: e.reply, reason: e.reason, notes: e.notes, nextAction: e.nextAction, file: e.file })) };
      const report = { date, generatedAt: now, engine: 'local', model: engine.state.modelName, overview, conversations: entries.map((e) => ({ threadId: e.threadId, accountId: e.accountId, name: e.name, relation: e.relation, relationNote: e.relationNote, brief: e.brief, summary: e.summary, topics: e.topics, timeline: e.timeline, keyFacts: e.keyFacts, decisions: e.decisions, tasksForYou: e.tasksForYou, openQuestions: e.openQuestions, sentiment: e.sentiment, kind: e.kind, file: e.file })), actionItems };
      fs.writeFileSync(path.join(L.resultsDir, 'bao-cao', `${date}.json`), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(L.resultsDir, 'bao-cao', `${date}.md`), renderReportMd(report));
      fs.writeFileSync(path.join(L.resultsDir, `${date}-tong-hop.md`), renderTongHopMd(dateText, entries));
      fs.writeFileSync(path.join(L.resultsDir, 'de-xuat.json'), JSON.stringify(deXuat, null, 2));
      savePrev(nextPrev);
      st.lastResult = { conversations: entries.length, reused: st.reused, withReply: entries.filter((e) => e.reply).length, date };
      log?.info(`AI cục bộ (${reason}): ${entries.length} hội thoại (${st.reused} dùng lại), ${st.lastResult.withReply} gợi ý trả lời, ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
    } catch (err) {
      st.lastError = err?.message ?? String(err);
      log?.error(`AI cục bộ thất bại: ${st.lastError}`);
    } finally {
      st.running = false; st.phase = 'idle'; st.current = null; st.lastRunAt = Date.now(); st.lastDurationMs = Date.now() - t0; st.startedAt = null; emit();
    }
    return status();
  }

  return { run, status };
}
