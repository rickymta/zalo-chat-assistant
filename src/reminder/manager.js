/**
 * Nhắc việc CHƯA PHẢN HỒI (thông báo trên máy).
 *
 * - Cứ mỗi `intervalMinutes` phút (mặc định 15) QUÉT NGẦM: đọc thẳng bảng conversations (KHÔNG chạy AI),
 *   gom các hội thoại 1-1 mà tin cuối là của đối phương (mình chưa trả lời), theo từng kênh đang kết nối.
 * - Ở các MỐC GIỜ đã đặt (mặc định đầu giờ sáng + đầu giờ chiều, thêm mốc tuỳ ý) thì gửi một THÔNG BÁO
 *   HỆ ĐIỀU HÀNH tổng hợp, nội dung theo `level`: full (đầy đủ) · brief (rút gọn) · count (chỉ số lượng).
 *
 * Không gửi bản tin giọng nói / Telegram (đó là việc của DigestManager, độc lập). Không nhắc rải rác giữa
 * các mốc — 15 phút chỉ để giữ số liệu luôn mới cho lần gửi kế tiếp và cho giao diện.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { dayKeyVn } from '../reports.js';
import { CHANNELS, sourceOf } from '../digest/manager.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';
const hhmmVn = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const buoiOf = (hhmm) => (Number(hhmm.slice(0, 2)) < 12 ? 'sáng' : (Number(hhmm.slice(0, 2)) < 18 ? 'chiều' : 'tối'));
const LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

export class ReminderManager extends EventEmitter {
  constructor({ db, log, integrations, file, getConnected, notify }) {
    super();
    this.db = db; this.log = log; this.integrations = integrations; this.file = file;
    this.getConnected = getConnected || (() => ({ zalo: true, telegram: true, email: true, lark: true }));
    this.notify = notify || (() => {});
    this.state = this.load(); this.timer = null; this.scanning = false;
    this.snapshot = this.state.snapshot ?? null; this.lastScanAt = this.state.lastScanAt ?? 0; this.lastError = null;
  }

  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { sent: {}, history: [] }; } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 }); }
  cfg() { return this.integrations.view('reminder'); }
  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }

  status() {
    const cfg = this.cfg();
    return {
      enabled: !!cfg.enabled, intervalMinutes: cfg.intervalMinutes ?? 15, times: cfg.times ?? [], level: cfg.level ?? 'full',
      connectedOnly: cfg.connectedOnly !== false, windowDays: cfg.windowDays ?? 7,
      lastScanAt: this.lastScanAt || null, snapshot: this.snapshot, nextAt: this.nextAt(cfg), lastError: this.lastError,
      connected: this.getConnected(), history: (this.state.history ?? []).slice(-10).reverse(),
    };
  }

  nextAt(cfg = this.cfg()) {
    if (!cfg.enabled || !cfg.times?.length) return null;
    const now = Date.now();
    for (let d = 0; d < 2; d++) for (const t of [...cfg.times].sort()) {
      const key = dayKeyVn(now + d * 86400e3); const at = Date.parse(`${key}T${t}:00+07:00`);
      if (at > now && !this.state.sent?.[`${key} ${t}`]) return at;
    }
    return null;
  }

  schedule() { this.stop(); this.timer = setInterval(() => { void this.tick(); }, 30e3); void this.tick(); this.emitChange(); }
  stop() { clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (!this.db?.unlocked) return;
    const cfg = this.cfg();
    if (!cfg.enabled) return;
    const now = Date.now();
    // Quét ngầm định kỳ để số liệu luôn mới (rẻ — chỉ đọc DB).
    const intervalMs = Math.max(1, cfg.intervalMinutes ?? 15) * 60e3;
    if (now - (this.lastScanAt || 0) >= intervalMs) this.scan(cfg);
    // Đến mốc giờ ⇒ gửi thông báo (bù trong 20 phút nếu máy vừa ngủ dậy).
    const key = dayKeyVn(now); const hhmm = hhmmVn(now);
    for (const t of cfg.times ?? []) {
      const k = `${key} ${t}`;
      if (this.state.sent?.[k]) continue;
      const at = Date.parse(`${key}T${t}:00+07:00`);
      if (now >= at && now - at < 20 * 60e3) { this.fireAt(k, `mốc ${t}`, cfg); return; }
      if (now - at >= 20 * 60e3 && hhmm > t) { (this.state.sent ??= {})[k] = { skipped: true, at: now }; this.save(); }
    }
  }

  /** Quét (đọc DB) → dựng snapshot theo kênh. Trả về snapshot. */
  scan(cfg = this.cfg()) {
    if (this.scanning) return this.snapshot;
    this.scanning = true;
    try {
      const sinceMs = Date.now() - Math.max(1, cfg.windowDays ?? 7) * 86400e3;
      const rows = this.db.unansweredConversations({ sinceMs, limit: 2000 });
      const connected = this.getConnected() || {};
      const only = cfg.connectedOnly !== false;
      const byCh = new Map(CHANNELS.map((c) => [c.key, []]));
      for (const r of rows) {
        const ch = sourceOf(r.thread_id);
        if (only && connected[ch] === false) continue;   // chỉ tính kênh đang kết nối
        (byCh.get(ch) ?? byCh.set(ch, []).get(ch)).push({ name: r.name || 'Không tên', lastAt: r.last_message_at });
      }
      const channels = CHANNELS
        .map((c) => ({ key: c.key, label: c.label, emoji: c.emoji, count: (byCh.get(c.key) ?? []).length, names: (byCh.get(c.key) ?? []).slice(0, 8).map((x) => x.name) }))
        .filter((c) => c.count > 0);
      const total = channels.reduce((n, c) => n + c.count, 0);
      this.snapshot = { at: Date.now(), total, channels };
      this.lastScanAt = Date.now();
      this.state.snapshot = this.snapshot; this.state.lastScanAt = this.lastScanAt; this.save();
      this.lastError = null;
      this.emitChange();
      return this.snapshot;
    } catch (err) {
      this.lastError = String(err?.message ?? err).slice(0, 200);
      this.log?.warn(`Nhắc việc: quét lỗi — ${this.lastError}`);
      return this.snapshot;
    } finally { this.scanning = false; }
  }

  /** Dựng {title, body} theo mức độ. Trả null nếu không có gì để nhắc. */
  content(snapshot, level = 'full', { now = Date.now() } = {}) {
    const snap = snapshot ?? { total: 0, channels: [] };
    const total = snap.total || 0;
    const buoi = buoiOf(hhmmVn(now));
    if (total === 0) return null;
    const title = `🔔 ${total} hội thoại chưa phản hồi`;
    if (level === 'count') return { title, body: `Đang chờ bạn trả lời — nhắc ${buoi}.` };
    if (level === 'brief') {
      const top = snap.channels.map((c) => `${c.label} ${c.count}`).join(' · ');
      return { title, body: `${top || 'trên các kênh'} — mở ứng dụng để trả lời.` };
    }
    // full: liệt kê theo kênh kèm vài tên
    const lines = snap.channels.map((c) => {
      const names = c.names.slice(0, 4).join(', ');
      const more = c.count > 4 ? ` +${c.count - 4}` : '';
      return `${c.emoji} ${c.label} (${c.count}): ${names}${more}`;
    });
    return { title, body: lines.join('\n') };
  }

  /** Gửi thông báo ở một mốc giờ (dedup theo ngày). */
  fireAt(key, reason, cfg = this.cfg()) {
    const snap = this.scan(cfg);   // quét mới ngay trước khi gửi để số liệu chuẩn
    const c = this.content(snap, cfg.level, { now: Date.now() });
    const entry = { at: Date.now(), reason, total: snap?.total ?? 0 };
    (this.state.sent ??= {})[key] = { at: Date.now(), total: snap?.total ?? 0, notified: !!c };
    if (c) { try { this.notify({ ...c, total: snap.total, channels: snap.channels, reason }); entry.notified = true; } catch (err) { entry.error = String(err?.message ?? err).slice(0, 200); } }
    else { entry.empty = true; }   // không có gì chờ trả lời ⇒ không làm phiền
    (this.state.history ??= []).push(entry); this.state.history = this.state.history.slice(-50); this.save();
    this.log?.info(`Nhắc việc (${reason}): ${entry.notified ? `đã thông báo ${entry.total} hội thoại chưa phản hồi` : 'không có hội thoại nào chờ trả lời'}.`);
    this.emitChange();
  }

  /** Gửi thử ngay (nút "Gửi thử" trong cài đặt) — luôn hiện, kể cả khi không có việc (báo "không có"). */
  test() {
    const cfg = this.cfg();
    const snap = this.scan(cfg);
    const c = this.content(snap, cfg.level, { now: Date.now() }) ?? { title: '🔔 Nhắc việc chưa phản hồi', body: 'Hiện không có hội thoại nào đang chờ bạn trả lời.' };
    try { this.notify({ ...c, total: snap?.total ?? 0, channels: snap?.channels ?? [], reason: 'thử' }); } catch { /* bỏ qua */ }
    return { ok: true, ...this.status() };
  }
}
