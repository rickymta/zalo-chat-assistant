/**
 * Bản tin giọng nói (F5): theo giờ đã đặt (hoặc bấm "Gửi ngay"), cập nhật gói du-lieu/ → chạy AI cục bộ → dựng bản tin từ báo cáo
 * ngày (tổng quan, điểm nổi bật, việc cần làm, hội thoại đang chờ) → đọc bằng Microsoft Edge TTS (msedge-tts, MP3) → gửi qua bot
 * Telegram: sendVoice (giọng nói) + sendMessage (bản chữ, tuỳ chọn). Chống gửi trùng theo khoá "YYYY-MM-DD HH:MM" trong data/digest.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadReport, dayKeyVn } from '../reports.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';
export const DEFAULT_VOICE = 'google:vi-bac';   // giọng nữ miền Bắc (Google) — mặc định
export const isGoogleVoice = (v) => String(v ?? '').startsWith('google');
/** Danh sách giọng cho giao diện. */
export const VOICES = [
  { id: 'google:vi-bac', label: 'Nữ miền Bắc (Google)', provider: 'google' },
  { id: 'vi-VN-HoaiMyNeural', label: 'Nữ miền Nam — Hoài My (Microsoft)', provider: 'edge' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam — Nam Minh (Microsoft)', provider: 'edge' },
];

/** Cắt văn bản thành đoạn ≤ maxLen ký tự theo ranh giới câu/từ (Google Translate TTS giới hạn ~200 ký tự/lần). */
export function chunkText(text, maxLen = 190) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  const out = []; let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let part of sentences) {
    if (part.length > maxLen) {                       // câu quá dài ⇒ cắt tiếp theo từ
      for (const w of part.split(' ')) { if ((cur + ' ' + w).trim().length > maxLen) push(); cur = (cur ? cur + ' ' : '') + w; }
      continue;
    }
    if ((cur + part).length > maxLen) push();
    cur += part;
  }
  push();
  return out;
}

async function googleTtsToFile(text, dest) {
  const parts = chunkText(text, 190);
  const buffers = [];
  for (let i = 0; i < parts.length; i++) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&idx=${i}&total=${parts.length}&textlen=${parts[i].length}&q=${encodeURIComponent(parts[i])}`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Referer: 'https://translate.google.com/' }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 200) throw new Error('đoạn rỗng');
        buffers.push(buf); ok = true;
      } catch (err) { if (attempt === 2) throw new Error(`Google TTS lỗi ở đoạn ${i + 1}/${parts.length}: ${err?.message ?? err}`); await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
    }
    await new Promise((r) => setTimeout(r, 120));   // nhẹ tay để không bị chặn tần suất
  }
  fs.writeFileSync(dest, Buffer.concat(buffers));
}

async function edgeTtsToFile(text, voice, dir, dest) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice || 'vi-VN-HoaiMyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const tmp = fs.mkdtempSync(path.join(dir, 'tts-'));
  const { audioFilePath } = await tts.toFile(tmp, text, { rate: '+5%' });
  fs.renameSync(audioFilePath, dest); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  try { tts.close?.(); } catch { /* bỏ qua */ }
}
const hhmmVn = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const dateVnText = (key) => key.split('-').reverse().join('/');
const MAX_SPOKEN = 3600;      // ~5 phút đọc (người dùng: báo cáo có thể dài, không quá vắn tắt)
const MAX_TG_TEXT = 4050;
const KEEP_DAYS = 7;
const PRIO = { P1: 0, P2: 1, P3: 2, none: 3 };
const short = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Gom danh sách việc [{name, task, priority}] theo NGƯỜI/NHÓM: giữ thứ tự xuất hiện, ưu tiên cao nhất của nhóm; sắp nhóm theo ưu tiên. */
export function groupTasks(tasks) {
  const order = []; const map = new Map();
  for (const t of tasks) {
    if (!t?.task) continue;
    const key = t.name || '(không rõ)';
    if (!map.has(key)) { map.set(key, { name: key, priority: t.priority ?? 'P3', tasks: [] }); order.push(key); }
    const g = map.get(key); g.tasks.push(t.task);
    if ((PRIO[t.priority] ?? 9) < (PRIO[g.priority] ?? 9)) g.priority = t.priority;
  }
  return order.map((k) => map.get(k)).sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9));
}

/** Bỏ ký hiệu markdown/emoji để đọc cho tự nhiên. */
export function spokenClean(s) {
  return String(s ?? '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '').replace(/\n+/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Dựng hai bản: `spoken` (đọc) và `text` (gửi chữ) từ báo cáo ngày. */
/** Kênh nguồn suy từ tiền tố account_id. */
export const CHANNELS = [
  { key: 'zalo', label: 'Zalo', emoji: '💬' },
  { key: 'telegram', label: 'Telegram', emoji: '✈️' },
  { key: 'email', label: 'Email', emoji: '✉️' },
  { key: 'lark', label: 'Lark Approval', emoji: '📋' },
];
export function sourceOf(id) { id = String(id ?? ''); return id.startsWith('tg:') ? 'telegram' : id.startsWith('mail:') ? 'email' : id.startsWith('lark:') ? 'lark' : 'zalo'; }
const buoiOf = (hhmm) => (Number(hhmm.slice(0, 2)) < 12 ? 'sáng' : (Number(hhmm.slice(0, 2)) < 18 ? 'chiều' : 'tối'));
function counts(convs) {
  const messages = convs.reduce((n, c) => n + (c.messages || 0), 0);
  const waiting = convs.filter((c) => !c.isGroup && c.lastOutbound === false && (c.inbound || 0) > 0);
  return { conversations: convs.length, messages, needReply: waiting.length, waiting };
}
/** Danh sách việc [{name, task, priority, accountId}] từ báo cáo (actionItems) hoặc từ tasksForYou của hội thoại. */
function tasksOf(report, convs) {
  return (Array.isArray(report?.actionItems) && report.actionItems.length
    ? report.actionItems.map((a) => ({ name: a.name, task: a.task, priority: a.priority ?? 'P3', accountId: a.accountId }))
    : convs.flatMap((c) => (c.claude?.tasksForYou ?? []).map((t) => ({ name: c.name, task: t, priority: c.claude?.priority ?? 'P3', accountId: c.accountId })))
  ).filter((t) => t.task);
}

/** Dựng MỘT bản tin (bản đọc + bản chữ) cho một tập hội thoại/việc. `label` rỗng = bản gộp mọi kênh. */
export function composeOne({ date, hhmm, buoi, label = '', emoji = '🗞', convs, tasks, claude = null }) {
  const c = counts(convs);
  const withAi = convs.filter((x) => x.claude);
  const hot = withAi.filter((x) => ['P1', 'P2'].includes(x.claude?.priority)).slice(0, 5);
  const taskGroups = groupTasks([...tasks].sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9)));
  const overviewText = spokenClean(claude?.summary || claude?.brief || '');
  const stt = ['một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám'];

  const sp = [];
  sp.push(`Bản tin ${buoi}${label ? `, kênh ${label}` : ''} ngày ${dateVnText(date)}, lúc ${hhmm.replace(':', ' giờ ')}.`);
  sp.push(`${label ? `Kênh ${label} có` : 'Hôm nay có'} ${c.conversations} hội thoại với ${c.messages} tin, trong đó ${c.needReply} hội thoại đang chờ bạn trả lời.`);
  if (overviewText) sp.push(short(overviewText, 900));
  else if (hot.length) sp.push('Cần chú ý: ' + hot.map((x) => `${x.name}: ${spokenClean(x.claude.brief || x.claude.summary)}`).join('. ') + '.');
  if (claude?.highlights?.length) sp.push('Điểm nổi bật: ' + claude.highlights.slice(0, 5).map((h, i) => `${i + 1}, ${spokenClean(h)}`).join('. ') + '.');
  if (taskGroups.length) {
    const say = (g) => `Với ${g.name}: ` + g.tasks.map((t, i) => (g.tasks.length > 1 ? `${stt[i] || (i + 1)}, ` : '') + spokenClean(t)).join('; ') + '.';
    sp.push(`Việc cần bạn xử lý, ${tasks.length} việc cho ${taskGroups.length} người. ` + taskGroups.map(say).join(' '));
  }
  if (c.waiting.length) sp.push(`Đang chờ trả lời: ${c.waiting.slice(0, 5).map((x) => x.name).join(', ')}${c.waiting.length > 5 ? ` và ${c.waiting.length - 5} hội thoại khác` : ''}.`);
  if (!overviewText && !taskGroups.length && !c.waiting.length && !hot.length) sp.push('Chưa có nội dung mới. Hết bản tin.'); else sp.push('Hết bản tin.');
  let spoken = sp.join(' ');
  if (spoken.length > MAX_SPOKEN) spoken = spoken.slice(0, MAX_SPOKEN - 20).replace(/[^.]*$/, '') + ' Hết bản tin.';

  const tx = [];
  tx.push(`${emoji} Bản tin ${buoi}${label ? ` · ${label}` : ''} ${dateVnText(date)} · ${hhmm}`);
  tx.push(`${c.conversations} hội thoại · ${c.messages} tin · ${c.needReply} đang chờ trả lời`);
  if (overviewText) tx.push('', short(overviewText, 1200));
  if (claude?.highlights?.length) tx.push('', '✨ Nổi bật:', ...claude.highlights.slice(0, 6).map((h) => `• ${spokenClean(h)}`));
  else if (hot.length) tx.push('', '⭐ Cần chú ý:', ...hot.map((x) => `• ${x.name}: ${spokenClean(x.claude.brief || x.claude.summary)}`));
  if (taskGroups.length) {
    tx.push('', `✅ Việc của bạn (${tasks.length} việc · ${taskGroups.length} người/nhóm):`);
    for (const g of taskGroups) { tx.push(`👤 ${g.name}${g.priority ? ` [${g.priority}]` : ''}:`, ...g.tasks.map((t) => `   • ${spokenClean(t)}`)); }
  }
  if (c.waiting.length) tx.push('', `⏳ Chờ trả lời (${c.waiting.length}): ` + c.waiting.slice(0, 8).map((x) => x.name).join(', '));
  if (tx.length <= 2) tx.push('', 'Chưa có nội dung tổng hợp mới.');
  let text = tx.join('\n');
  if (text.length > MAX_TG_TEXT) text = text.slice(0, MAX_TG_TEXT - 2) + '…';
  return { spoken, text, date, hhmm, counts: { conversations: c.conversations, messages: c.messages, tasks: tasks.length, waiting: c.waiting.length } };
}

/** Bản tin GỘP mọi kênh (dùng cho xem trước tổng và tương thích cũ). */
export function composeDigest(report, { now = Date.now() } = {}) {
  const date = report?.date ?? dayKeyVn(now); const hhmm = hhmmVn(now); const buoi = buoiOf(hhmm);
  const convs = (report?.conversations ?? []).filter(Boolean);
  const ov = report?.overview ?? {};
  const claude = (ov.claudeSummary || ov.claudeBrief || ov.highlights?.length) ? { summary: ov.claudeSummary, brief: ov.claudeBrief, highlights: ov.highlights ?? [] } : null;
  return composeOne({ date, hhmm, buoi, convs, tasks: tasksOf(report, convs), claude });
}

/** Một bản tin RIÊNG cho mỗi kênh có nội dung (Zalo / Telegram / Email / Lark). */
export function composeChannelDigests(report, { now = Date.now() } = {}) {
  const date = report?.date ?? dayKeyVn(now); const hhmm = hhmmVn(now); const buoi = buoiOf(hhmm);
  const convs = (report?.conversations ?? []).filter(Boolean);
  const tasks = tasksOf(report, convs);
  const out = [];
  for (const ch of CHANNELS) {
    const cc = convs.filter((c) => sourceOf(c.accountId) === ch.key);
    const ct = tasks.filter((t) => sourceOf(t.accountId) === ch.key);
    if (!cc.length && !ct.length) continue;
    out.push({ channel: ch.key, label: ch.label, emoji: ch.emoji, ...composeOne({ date, hhmm, buoi, label: ch.label, emoji: ch.emoji, convs: cc, tasks: ct, claude: null }) });
  }
  return out;
}

export class DigestManager extends EventEmitter {
  constructor({ db, log, integrations, file, dir, workspaceRoot, refresh, getReport }) {
    super();
    this.db = db; this.log = log; this.integrations = integrations; this.file = file; this.dir = dir; this.root = workspaceRoot;
    this.refresh = refresh;       // async () => cập nhật gói + chạy AI tới khi xong
    this.getReport = getReport ?? ((date) => loadReport(this.root, this.db, date));
    this.state = this.load(); this.timer = null; this.sending = false; this.phase = 'idle'; this.lastError = null;
  }
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { sent: {}, history: [] }; } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 }); }
  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }
  status() {
    const cfg = this.integrations.view('digest');
    return { enabled: !!cfg.enabled, configured: !!cfg.configured, times: cfg.times ?? [], voice: cfg.voice, chatId: cfg.chatId || null, sendText: cfg.sendText !== false,
      sending: this.sending, phase: this.phase, lastError: this.lastError, nextAt: this.nextAt(cfg), history: (this.state.history ?? []).slice(-10).reverse() };
  }
  nextAt(cfg) {
    if (!cfg.enabled || !cfg.configured || !cfg.times?.length) return null;
    const now = Date.now();
    for (let d = 0; d < 2; d++) for (const t of [...cfg.times].sort()) {
      const key = dayKeyVn(now + d * 86400e3); const at = Date.parse(`${key}T${t}:00+07:00`);
      if (at > now && !this.state.sent?.[`${key} ${t}`]) return at;
    }
    return null;
  }
  schedule() { this.stop(); this.timer = setInterval(() => { void this.tick(); }, 30e3); this.emitChange(); }
  stop() { clearInterval(this.timer); this.timer = null; }
  async tick() {
    const cfg = this.integrations.view('digest');
    if (!cfg.enabled || !cfg.configured || this.sending) return;
    const now = Date.now(); const key = dayKeyVn(now); const hhmm = hhmmVn(now);
    for (const t of cfg.times ?? []) {
      const k = `${key} ${t}`;
      if (this.state.sent?.[k]) continue;
      const at = Date.parse(`${key}T${t}:00+07:00`);
      // Đến giờ (trong 20 phút sau mốc — máy ngủ qua mốc thì vẫn gửi bù, muộn hơn thì bỏ)
      if (now >= at && now - at < 20 * 60e3) { await this.sendNow(`lịch ${t}`, { key: k }); return; }
      if (now - at >= 20 * 60e3 && hhmm > t) { (this.state.sent ??= {})[k] = { skipped: true, at: now }; this.save(); }
    }
  }

  /** Gửi bản tin: làm mới dữ liệu + AI, dựng nội dung, đọc, gửi. `preview` = chỉ dựng nội dung, không gửi. */
  async sendNow(reason = 'tay', { key = null, preview = false, skipRefresh = false } = {}) {
    if (this.sending) return this.status();
    const cfg = this.integrations.secrets('digest');
    if (!preview && (!cfg.botToken || !cfg.chatId)) { this.lastError = 'Chưa có bot token / chat ID.'; this.emitChange(); return this.status(); }
    this.sending = true; this.lastError = null; this.phase = 'refresh'; this.emitChange();
    const t0 = Date.now(); let entry = { at: t0, reason, ok: false };
    try {
      if (!skipRefresh && this.refresh) { try { await this.refresh(); } catch (err) { this.log?.warn(`Bản tin: làm mới dữ liệu lỗi, dùng báo cáo hiện có: ${err?.message ?? err}`); } }
      this.phase = 'compose'; this.emitChange();
      const report = this.getReport(dayKeyVn(Date.now()));
      // MỖI KÊNH một bản tin riêng (Zalo / Telegram / Email / Lark), gửi voice riêng. Không có kênh nào có nội dung ⇒ một dòng báo "chưa có".
      const digests = composeChannelDigests(report, { now: Date.now() });
      entry = { ...entry, date: report?.date ?? dayKeyVn(Date.now()), channels: digests.map((d) => ({ channel: d.channel, counts: d.counts })) };
      if (preview) { entry.ok = true; entry.preview = true; this.lastPreview = { channels: digests, at: Date.now() }; return { ...this.status(), preview: { channels: digests } }; }
      const base = `https://api.telegram.org/bot${cfg.botToken}`;
      if (!digests.length) {
        this.phase = 'send'; this.emitChange();
        await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text: `🗞 Bản tin ${dateVnText(report?.date ?? dayKeyVn(Date.now()))}: chưa có hoạt động mới trên các kênh.` }), signal: AbortSignal.timeout(30000) }).then((r) => r.json());
        entry.ok = true; entry.empty = true;
      } else {
        const results = [];
        for (const d of digests) {
          this.phase = 'tts'; this.emitChange();
          const audio = await this.synthesize(d.spoken, cfg.voice, `-${d.channel}`);
          this.phase = 'send'; this.emitChange();
          const form = new FormData();
          form.append('chat_id', cfg.chatId);
          form.append('caption', short(`${d.emoji} ${d.label} · ${dateVnText(d.date)} ${d.hhmm} — ${d.counts.conversations} hội thoại, ${d.counts.tasks} việc, ${d.counts.waiting} chờ trả lời`, 1000));
          form.append('voice', new Blob([fs.readFileSync(audio.file)], { type: 'audio/mpeg' }), `ban-tin-${d.channel}-${d.date}-${d.hhmm.replace(':', '')}.mp3`);
          const rv = await fetch(`${base}/sendVoice`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }).then((r) => r.json());
          if (!rv.ok) throw new Error(`sendVoice (${d.label}) thất bại (${rv.error_code}): ${rv.description}`);
          if (cfg.sendText !== false) {
            const rt = await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text: d.text, disable_web_page_preview: true }), signal: AbortSignal.timeout(30000) }).then((r) => r.json());
            if (!rt.ok) this.log?.warn(`Bản tin ${d.label}: gửi bản chữ thất bại (${rt.error_code}): ${rt.description}`);
          }
          results.push(`${d.label} ${Math.round(audio.bytes / 1024)}KB`);
          await new Promise((r) => setTimeout(r, 400));   // giãn nhịp giữa các kênh cho Telegram
        }
        entry.ok = true; entry.sent = results;
        this.log?.info(`Bản tin (${reason}): đã gửi ${digests.length} kênh riêng (${results.join(', ')}) vào chat ${cfg.chatId} (${((Date.now() - t0) / 1000).toFixed(0)}s).`);
      }
      entry.ms = Date.now() - t0;
      if (key) (this.state.sent ??= {})[key] = { at: Date.now() };
      this.cleanup();
    } catch (err) {
      entry.error = String(err?.message ?? err).slice(0, 300); this.lastError = entry.error;
      this.log?.error(`Bản tin (${reason}) lỗi: ${err?.message ?? err}`);
    } finally {
      if (!entry.preview) { (this.state.history ??= []).push(entry); this.state.history = this.state.history.slice(-50); this.save(); }
      this.sending = false; this.phase = 'idle'; this.emitChange();
    }
    return this.status();
  }

  /** Đọc văn bản → MP3 trong data/digest/. Giọng "google" = giọng nữ MIỀN BẮC của Google (không cần khoá); còn lại là giọng Edge. */
  async synthesize(text, voice = DEFAULT_VOICE, tag = '') {
    fs.mkdirSync(this.dir, { recursive: true });
    const dest = path.join(this.dir, `ban-tin-${dayKeyVn(Date.now())}-${hhmmVn(Date.now()).replace(':', '')}${tag}-${Math.random().toString(36).slice(2, 6)}.mp3`);
    if (isGoogleVoice(voice)) await googleTtsToFile(text, dest);
    else await edgeTtsToFile(text, voice, this.dir, dest);
    const bytes = fs.statSync(dest).size;
    if (bytes < 2000) throw new Error('Dịch vụ đọc trả về tệp rỗng (mạng hoặc dịch vụ đọc gặp lỗi).');
    return { file: dest, bytes };
  }
  cleanup() {
    try { const cut = Date.now() - KEEP_DAYS * 86400e3; for (const f of fs.readdirSync(this.dir)) { const p = path.join(this.dir, f); try { if (fs.statSync(p).mtimeMs < cut) fs.rmSync(p, { recursive: true, force: true }); } catch { /* bỏ qua */ } } } catch { /* bỏ qua */ }
  }
}
