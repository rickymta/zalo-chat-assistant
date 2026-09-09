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
const hhmmVn = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const dateVnText = (key) => key.split('-').reverse().join('/');
const MAX_SPOKEN = 2600;      // ~3–4 phút đọc
const MAX_TG_TEXT = 3900;
const KEEP_DAYS = 7;
const PRIO = { P1: 0, P2: 1, P3: 2, none: 3 };
const short = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Bỏ ký hiệu markdown/emoji để đọc cho tự nhiên. */
export function spokenClean(s) {
  return String(s ?? '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '').replace(/\n+/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Dựng hai bản: `spoken` (đọc) và `text` (gửi chữ) từ báo cáo ngày. */
export function composeDigest(report, { now = Date.now(), label = '' } = {}) {
  const date = report?.date ?? dayKeyVn(now);
  const hhmm = hhmmVn(now);
  const buoi = label || (Number(hhmm.slice(0, 2)) < 12 ? 'sáng' : (Number(hhmm.slice(0, 2)) < 18 ? 'chiều' : 'tối'));
  const ov = report?.overview ?? {};
  // loadReport() trải tổng quan của AI vào overview.claudeSummary / claudeBrief / highlights và actionItems ở gốc.
  const claude = ov.claudeSummary || ov.claudeBrief || ov.highlights?.length ? { summary: ov.claudeSummary, brief: ov.claudeBrief, highlights: ov.highlights ?? [] } : null;
  const convs = (report?.conversations ?? []).filter((c) => c);
  const withAi = convs.filter((c) => c.claude);
  const tasks = (Array.isArray(report?.actionItems) && report.actionItems.length
    ? report.actionItems.map((a) => ({ name: a.name, task: a.task, priority: a.priority ?? 'P3' }))
    : convs.flatMap((c) => (c.claude?.tasksForYou ?? []).map((t) => ({ name: c.name, task: t, priority: c.claude?.priority ?? 'P3' })))
  ).filter((t) => t.task).sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9));
  const waiting = convs.filter((c) => !c.isGroup && c.lastOutbound === false && c.inbound > 0);
  const hot = withAi.filter((c) => ['P1', 'P2'].includes(c.claude?.priority)).slice(0, 5);

  const sp = [];
  sp.push(`Bản tin ${buoi} ngày ${dateVnText(date)}, lúc ${hhmm.replace(':', ' giờ ')}.`);
  if (ov.conversations != null) sp.push(`Hôm nay có ${ov.conversations} hội thoại với ${ov.messages ?? 0} tin, trong đó ${ov.needReply ?? waiting.length} hội thoại đang chờ bạn trả lời.`);
  const overviewText = spokenClean(claude?.summary || claude?.brief || '');
  if (overviewText) sp.push(short(overviewText, 900));
  if (claude?.highlights?.length) sp.push('Điểm nổi bật: ' + claude.highlights.slice(0, 5).map((h, i) => `${i + 1}, ${spokenClean(h)}`).join('. ') + '.');
  else if (hot.length) sp.push('Cần chú ý: ' + hot.map((c) => `${c.name}: ${spokenClean(c.claude.brief || c.claude.summary)}`).join('. ') + '.');
  if (tasks.length) sp.push(`Việc cần bạn xử lý, ${tasks.length} việc: ` + tasks.slice(0, 6).map((t, i) => `${i + 1}, ${t.name}: ${spokenClean(t.task)}`).join('. ') + (tasks.length > 6 ? `. Và ${tasks.length - 6} việc khác trong ứng dụng.` : '.'));
  if (waiting.length) sp.push(`Đang chờ trả lời: ${waiting.slice(0, 5).map((c) => c.name).join(', ')}${waiting.length > 5 ? ` và ${waiting.length - 5} hội thoại khác` : ''}.`);
  if (!overviewText && !tasks.length && !waiting.length) sp.push('Chưa có nội dung tổng hợp mới. Hết bản tin.'); else sp.push('Hết bản tin.');
  let spoken = sp.join(' ');
  if (spoken.length > MAX_SPOKEN) spoken = spoken.slice(0, MAX_SPOKEN - 20).replace(/[^.]*$/, '') + ' Hết bản tin.';

  const tx = [];
  tx.push(`🗞 Bản tin ${buoi} ${dateVnText(date)} · ${hhmm}`);
  if (ov.conversations != null) tx.push(`${ov.conversations} hội thoại · ${ov.messages ?? 0} tin · ${ov.needReply ?? waiting.length} đang chờ trả lời`);
  if (overviewText) tx.push('', short(overviewText, 1200));
  if (claude?.highlights?.length) tx.push('', '✨ Nổi bật:', ...claude.highlights.slice(0, 6).map((h) => `• ${spokenClean(h)}`));
  if (tasks.length) tx.push('', `✅ Việc của bạn (${tasks.length}):`, ...tasks.slice(0, 8).map((t) => `• [${t.priority}] ${t.name}: ${spokenClean(t.task)}`));
  if (waiting.length) tx.push('', `⏳ Chờ trả lời (${waiting.length}): ` + waiting.slice(0, 8).map((c) => c.name).join(', '));
  let text = tx.join('\n');
  if (text.length > MAX_TG_TEXT) text = text.slice(0, MAX_TG_TEXT - 2) + '…';
  return { spoken, text, date, hhmm, counts: { conversations: ov.conversations ?? 0, tasks: tasks.length, waiting: waiting.length } };
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
      const d = composeDigest(report);
      entry = { ...entry, date: d.date, counts: d.counts, textChars: d.text.length, spokenChars: d.spoken.length };
      if (preview) { entry.ok = true; entry.preview = true; this.lastPreview = { ...d, at: Date.now() }; return { ...this.status(), preview: d }; }
      this.phase = 'tts'; this.emitChange();
      const audio = await this.synthesize(d.spoken, cfg.voice);
      entry.audio = path.basename(audio.file); entry.audioBytes = audio.bytes;
      this.phase = 'send'; this.emitChange();
      const base = `https://api.telegram.org/bot${cfg.botToken}`;
      const form = new FormData();
      form.append('chat_id', cfg.chatId);
      form.append('caption', short(`🗞 Bản tin ${dateVnText(d.date)} · ${d.hhmm} — ${d.counts.conversations} hội thoại, ${d.counts.tasks} việc, ${d.counts.waiting} chờ trả lời`, 1000));
      form.append('voice', new Blob([fs.readFileSync(audio.file)], { type: 'audio/mpeg' }), `ban-tin-${d.date}-${d.hhmm.replace(':', '')}.mp3`);
      const rv = await fetch(`${base}/sendVoice`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }).then((r) => r.json());
      if (!rv.ok) throw new Error(`sendVoice thất bại (${rv.error_code}): ${rv.description}`);
      entry.voiceMsgId = rv.result?.message_id ?? null;
      if (cfg.sendText !== false) {
        const rt = await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text: d.text, disable_web_page_preview: true }), signal: AbortSignal.timeout(30000) }).then((r) => r.json());
        if (!rt.ok) this.log?.warn(`Bản tin: gửi bản chữ thất bại (${rt.error_code}): ${rt.description}`); else entry.textMsgId = rt.result?.message_id ?? null;
      }
      entry.ok = true; entry.ms = Date.now() - t0;
      if (key) (this.state.sent ??= {})[key] = { at: Date.now() };
      this.log?.info(`Bản tin (${reason}): đã gửi giọng nói ${Math.round(audio.bytes / 1024)} KB${cfg.sendText !== false ? ' + bản chữ' : ''} vào chat ${cfg.chatId} (${((Date.now() - t0) / 1000).toFixed(0)}s).`);
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

  /** Đọc văn bản bằng Edge TTS → MP3 trong data/digest/. */
  async synthesize(text, voice = 'vi-VN-HoaiMyNeural') {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    fs.mkdirSync(this.dir, { recursive: true });
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice || 'vi-VN-HoaiMyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const tmp = fs.mkdtempSync(path.join(this.dir, 'tts-'));
    const { audioFilePath } = await tts.toFile(tmp, text, { rate: '+5%' });
    const name = `ban-tin-${dayKeyVn(Date.now())}-${hhmmVn(Date.now()).replace(':', '')}.mp3`;
    const dest = path.join(this.dir, name);
    fs.renameSync(audioFilePath, dest); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* bỏ qua */ }
    try { tts.close?.(); } catch { /* bỏ qua */ }
    const bytes = fs.statSync(dest).size;
    if (bytes < 2000) throw new Error('Edge TTS trả về tệp rỗng (mạng hoặc dịch vụ đọc gặp lỗi).');
    return { file: dest, bytes };
  }
  cleanup() {
    try { const cut = Date.now() - KEEP_DAYS * 86400e3; for (const f of fs.readdirSync(this.dir)) { const p = path.join(this.dir, f); try { if (fs.statSync(p).mtimeMs < cut) fs.rmSync(p, { recursive: true, force: true }); } catch { /* bỏ qua */ } } } catch { /* bỏ qua */ }
  }
}
