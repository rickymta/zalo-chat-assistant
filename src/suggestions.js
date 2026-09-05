/**
 * Đọc GỢI Ý PHẢN HỒI mà Claude Cowork ghi vào <workspace>/ket-qua/ và gắn vào đúng hội thoại.
 *
 * Nguồn ưu tiên: `ket-qua/de-xuat.json` (định dạng máy đọc, mô tả ở huong-dan/04 mục E). Không có thì đọc mọi
 * `ket-qua/*.md` theo mẫu phiếu B: `## [P2] Tên — du-lieu/hoi-thoai/001-ten.md` + nhãn đậm `**Đề xuất phản hồi…:**`.
 * Gắn hội thoại theo thứ tự: threadId trong JSON → `du-lieu/.map.json` (file → thread) → dòng "Mã thread" trong file
 * hội thoại được tham chiếu → trùng tên duy nhất trong CSDL. Theo dõi thư mục bằng fs.watch + quét lại mỗi 60 giây.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const LABEL_RE = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/;

function parseSections(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = /^##\s+\[([^\]]+)\]\s*(.+?)\s*(?:—|–|-)\s*(\S+\.md)\s*$/.exec(line) || /^##\s+\[([^\]]+)\]\s*(.+?)\s*$/.exec(line);
    if (h) { flush(); cur = { priority: h[1].trim(), name: h[2].trim(), file: h[3] ?? null, fields: {}, label: null }; continue; }
    if (/^##\s/.test(line) || /^---\s*$/.test(line)) { flush(); continue; }
    if (!cur) continue;
    const m = LABEL_RE.exec(line);
    if (m) { cur.label = m[1].trim().toLowerCase(); cur.fields[cur.label] = m[2] ? [m[2]] : []; continue; }
    if (cur.label) cur.fields[cur.label].push(line);
  }
  flush();
  const pick = (fields, prefix) => { const k = Object.keys(fields).find((x) => x.startsWith(prefix)); return k ? fields[k].join('\n').replace(/^\n+|\n+$/g, '').trim() : ''; };
  return out.map((s) => ({
    priority: s.priority, name: s.name, file: s.file,
    summary: pick(s.fields, 'tóm tắt'),
    reply: pick(s.fields, 'đề xuất phản hồi'),
    kind: /theo dõi/i.test(pick(s.fields, 'loại gợi ý')) ? 'theo-doi' : (s.priority === 'Nhóm' ? 'nhom' : 'tra-loi'),
    notes: pick(s.fields, 'ghi chú'),
    nextAction: pick(s.fields, 'hành động tiếp'),
  })).filter((s) => s.reply);
}

export class SuggestionStore extends EventEmitter {
  constructor({ root, db, log }) {
    super();
    this.root = root;
    this.dir = path.join(root, 'ket-qua');
    this.db = db;
    this.log = log;
    this.items = [];
    this.updatedAt = null;
    this.files = [];
    this.watcher = null;
    this.timer = null;
    this.debounce = null;
  }

  start() {
    this.stop();
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.watcher = fs.watch(this.dir, { persistent: false }, () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.refresh(), 800); });
    } catch (err) { this.log?.warn(`Không theo dõi được ket-qua/: ${err?.message ?? err}`); }
    this.timer = setInterval(() => this.refresh(), 60000);
    this.refresh();
  }

  stop() {
    try { this.watcher?.close(); } catch { /* bỏ qua */ }
    this.watcher = null;
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.debounce);
  }

  loadMap() {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, 'du-lieu', '.map.json'), 'utf8')); } catch { return {}; }
  }

  /** Đọc "Mã thread"/"Mã tài khoản" từ đầu file hội thoại đã xuất (bản cũ chưa có .map.json). */
  idsFromConvFile(rel) {
    try {
      const p = path.join(this.root, rel.replace(/^du-lieu\//, 'du-lieu/'));
      const head = fs.readFileSync(p.startsWith(this.root) ? p : path.join(this.root, 'du-lieu', rel), 'utf8').slice(0, 1500);
      const t = /Mã thread:\s*`([^`]+)`/.exec(head)?.[1] ?? null;
      const a = /Mã tài khoản:\s*`([^`]+)`/.exec(head)?.[1] ?? null;
      return t ? { threadId: t, accountId: a } : null;
    } catch { return null; }
  }

  refresh() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => !f.startsWith('.') && f !== 'README.md'); } catch { files = []; }
    const items = [];
    const seen = new Set();
    const push = (it, stamp) => {
      const key = `${it.threadId ?? it.file ?? it.name}|${(it.reply || it.reason || '').slice(0, 40)}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ ...it, writtenAt: stamp });
    };

    // 1) JSON máy đọc
    const jsonPath = path.join(this.dir, 'de-xuat.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
        const stamp = fs.statSync(jsonPath).mtimeMs;
        for (const r of list) {
          if (!r) continue;
          const reply = typeof r.reply === 'string' ? r.reply.trim() : '';
          const kind = r.kind ?? (reply ? 'tra-loi' : 'khong-can');
          if (!reply && kind !== 'khong-can') continue;
          push({ source: 'de-xuat.json', threadId: r.threadId ? String(r.threadId) : null, accountId: r.accountId ? String(r.accountId) : null, name: r.name ?? null, kind, reason: r.reason ?? '', priority: r.priority ?? null, summary: r.summary ?? '', reply, notes: r.notes ?? '', nextAction: r.nextAction ?? '', file: r.file ?? null }, stamp);
        }
      } catch (err) { this.log?.warn(`de-xuat.json không đọc được: ${err?.message ?? err}`); }
    }

    // 2) Markdown theo mẫu phiếu (mới nhất trước)
    const mdFiles = files.filter((f) => f.endsWith('.md')).map((f) => ({ f, m: fs.statSync(path.join(this.dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    for (const { f, m } of mdFiles) {
      try {
        for (const s of parseSections(fs.readFileSync(path.join(this.dir, f), 'utf8'))) push({ source: f, threadId: null, accountId: null, ...s }, m);
      } catch (err) { this.log?.warn(`Không đọc được ${f}: ${err?.message ?? err}`); }
    }

    // 3) Gắn hội thoại
    const map = this.loadMap();
    let convs = null;
    const convList = () => { if (!convs) { try { convs = this.db.selectConversationsForExport({ includeGroups: true }); } catch { convs = []; } } return convs; };
    for (const it of items) {
      if (!it.threadId && it.file) {
        const rel = it.file.replace(/^\.?\/?du-lieu\//, '');
        const hit = map[rel] ?? map[it.file];
        if (hit) { it.threadId = hit.threadId; it.accountId = hit.accountId; it.name = it.name ?? hit.name; }
        else { const ids = this.idsFromConvFile(rel); if (ids) { it.threadId = ids.threadId; it.accountId = it.accountId ?? ids.accountId; } }
      }
      if (!it.threadId && it.name) {
        const needle = it.name.trim().toLowerCase();
        const cands = convList().filter((c) => (c.name ?? '').trim().toLowerCase() === needle);
        if (cands.length === 1) { it.threadId = cands[0].thread_id; it.accountId = cands[0].account_id; }
      }
      if (it.threadId && !it.accountId) {
        const cands = convList().filter((c) => c.thread_id === it.threadId);
        if (cands.length) it.accountId = cands[0].account_id;
      }
      if (it.threadId) {
        const c = convList().find((x) => x.thread_id === it.threadId && (!it.accountId || x.account_id === it.accountId));
        it.conversationName = c?.name ?? it.name ?? null;
        it.hasNewer = !!(c?.last_message_at && it.writtenAt && c.last_message_at > it.writtenAt);
      }
      it.id = `${it.source}:${it.threadId ?? it.name ?? ''}:${Math.round(it.writtenAt)}`;
    }

    // Cùng hội thoại: ưu tiên mục có reply; khong-can chỉ giữ khi không có mục nào khác
    const withReply = new Set(items.filter((i) => i.reply && i.threadId).map((i) => i.threadId));
    const pruned = items.filter((i) => i.reply || !withReply.has(i.threadId));
    items.length = 0; items.push(...pruned);
    const changed = JSON.stringify(items.map((i) => [i.id, i.reply])) !== JSON.stringify(this.items.map((i) => [i.id, i.reply]));
    this.items = items;
    this.files = files;
    this.updatedAt = mdFiles[0]?.m ?? (fs.existsSync(jsonPath) ? fs.statSync(jsonPath).mtimeMs : null);
    if (changed) { this.log?.info(`Gợi ý từ Claude: ${items.length} mục (${items.filter((i) => i.threadId).length} gắn được hội thoại).`); this.emit('changed', this.summary()); }
    return this.summary();
  }

  summary() { return { count: this.items.length, withReply: this.items.filter((i) => i.reply).length, resolved: this.items.filter((i) => i.threadId).length, updatedAt: this.updatedAt, files: this.files }; }
  all() { return { ...this.summary(), items: this.items }; }
  forThread(accountId, threadId) { return this.items.filter((i) => i.threadId === String(threadId) && (!i.accountId || i.accountId === String(accountId))); }
}
