/**
 * Máy chủ HTTP cục bộ (bridge, Fastify) — phục vụ giao diện và API cho chính máy này.
 *
 * CHỈ nghe 127.0.0.1, không xác thực (không bao giờ mở ra mạng ngoài). Khi CHƯA mở khoá (chưa đăng nhập máy chủ
 * xác thực) mọi API dữ liệu trả 423 — chỉ còn màn đăng nhập, trạng thái, nhật ký.
 * `platform` là móc nối tuỳ môi trường (Electron: tự chạy khi bật máy, mở Finder…); Node thuần dùng bản mặc định.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import { updateWorkspaceData, clearWorkspaceData, workspaceInfo } from './workspace.js';
import { listReportDates, loadReport, dayKeyVn, claudeEntryFor } from './reports.js';
import { KNOWN_MODELS, listLocalModels } from './ai/models.js';

const defaultPlatform = {
  name: 'node',
  revealPath(p) { spawn('open', [p], { stdio: 'ignore', detached: true }).unref(); },
  getAutoStart() { return null; },
  setAutoStart() { return null; },
  appVersion: null,
};

const vnDayStart = (dateStr) => Date.parse(`${dateStr}T00:00:00+07:00`);
const todayVn = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Bộ lọc dữ liệu theo kiểu chọn nhanh — dùng chung cho nút trên giao diện và CLI. */
export function presetParams(preset, body = {}, settings = {}) {
  const now = Date.now();
  const p = {
    preset,
    includeGroups: body.includeGroups ?? !!settings.includeGroups,
    includeExcel: body.includeExcel ?? !!settings.includeExcel,
    includeJsonl: !!body.includeJsonl,
    fullHistory: !!body.fullHistory,
    accountIds: Array.isArray(body.accountIds) && body.accountIds.length ? body.accountIds : undefined,
    threadIds: Array.isArray(body.threadIds) && body.threadIds.length ? body.threadIds : undefined,
  };
  switch (preset) {
    case 'waiting': p.onlyWaiting = true; break;
    case 'today': p.from = vnDayStart(todayVn()); break;
    case 'week': p.from = now - 7 * 86400e3; break;
    case 'groups': p.onlyGroups = true; p.includeGroups = true; p.from = now - 7 * 86400e3; break;
    case 'all': break;
    case 'one': p.includeGroups = true; break;
    case 'custom':
      if (body.from) p.from = Number.isFinite(Number(body.from)) ? Number(body.from) : vnDayStart(body.from);
      if (body.to) p.to = Number.isFinite(Number(body.to)) ? Number(body.to) : vnDayStart(body.to) + 86400e3;
      break;
    default: p.onlyWaiting = true;
  }
  return p;
}

export function buildServer({ db, manager, log, settings, paths, platform = defaultPlatform, auth, security, events, automation, suggestions, power, updater, ai, telegram, integrations, mail, lark, digest }) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, forceCloseConnections: true });
  const sseClients = new Set();

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err, undefined); }
  });

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) { try { res.write(payload); } catch { sseClients.delete(res); } }
  }
  manager.on('message', (d) => broadcast('message', d));
  manager.on('status', (d) => broadcast('status', d));
  manager.on('qr', (d) => broadcast('qr', d));
  manager.on('progress', (d) => broadcast('progress', d));
  events.on('auth', (d) => broadcast('auth', d));
  events.on('security', (d) => broadcast('security', d));
  events.on('workspace', (d) => broadcast('workspace', d));
  events.on('suggestions', (d) => broadcast('suggestions', d));
  events.on('power', (d) => broadcast('power', d));
  events.on('update', (d) => broadcast('update', d));
  events.on('ai', (d) => broadcast('ai', d));
  events.on('telegram', (d) => broadcast('telegram', d));
  for (const ev of ['mail', 'lark', 'digest']) events.on(ev, (d) => broadcast(ev, d));
  app.addHook('onClose', async () => { for (const res of sseClients) { try { res.end(); } catch { /* bỏ qua */ } } sseClients.clear(); });

  // ── Gác khoá: chưa mở khoá thì chỉ cho các đường công khai ─────────────────────
  const OPEN_PREFIXES = ['/api/auth/', '/api/events', '/api/logs', '/api/state', '/api/settings', '/api/updates/', '/api/open-url'];
  app.addHook('onRequest', async (req, reply) => {
    if (security.unlocked) return;
    const url = req.url.split('?')[0];
    if (url === '/' || OPEN_PREFIXES.some((p) => url.startsWith(p))) return;
    await reply.code(423).send({ error: 'Chưa đăng nhập — hãy đăng nhập để mở khoá dữ liệu.' });
  });

  const withinAllowed = (p) => {
    const r = path.resolve(p);
    return [paths.dataDir, paths.workspaceDir].some((base) => r === path.resolve(base) || r.startsWith(path.resolve(base) + path.sep));
  };
  const withUi = (fn) => async (req, reply) => { try { return await fn(req, reply); } catch (err) { return reply.code(err.status ?? err.statusCode ?? 400).send({ error: err.message ?? String(err), ...(err.payload ?? {}) }); } };
  /** DB đang giữ dữ liệu của danh tính khác ⇒ 409 kèm số liệu để giao diện hỏi người dùng có xoá không. */
  const guardOwner = async (newUserId, resetData, undo) => {
    const conflict = security.ownerConflict(newUserId);
    if (!conflict) return;
    if (!resetData) { if (undo) await undo(); throw Object.assign(new Error('Máy này đang giữ dữ liệu của danh tính khác — cần xoá trước khi đăng nhập danh tính mới.'), { status: 409, payload: conflict }); }
    security.resetData();
  };

  // ── Giao diện ────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(paths.uiDir, 'index.html'), 'utf8')));

  // ── Trạng thái tổng ──────────────────────────────────────────────────────────
  app.get('/api/state', async () => {
    const unlocked = security.unlocked;
    // Tài khoản Telegram/Email/Lark (tg:, mail:, lark:) không phải Zalo — không đưa vào dải Zalo trên thanh trên (có thẻ riêng ở Kết nối).
    const accounts = unlocked ? db.listAccounts().filter((a) => !/^(tg|mail|lark):/.test(String(a.id))).map((a) => ({
      id: a.id, displayName: a.display_name, avatarUrl: a.avatar_url, phone: a.phone,
      status: manager.isLive(a.id) ? (a.status === 'reconnecting' ? 'reconnecting' : 'connected') : a.status,
      lastError: a.last_error, hasSession: !!manager.readSession(a.id),
      groupsImportedAt: a.groups_imported_at ?? null, importJob: manager.getImportStatus(a.id),
    })) : [];
    return {
      locked: !unlocked,
      auth: auth.publicState(),
      security: security.status(),
      accounts,
      stats: unlocked ? db.stats() : null,
      settings: settings.load(),
      paths: { dataDir: paths.dataDir, workspaceDir: paths.workspaceDir },
      platform: { name: platform.name, autoStart: platform.getAutoStart(), version: platform.appVersion },
      workspace: unlocked ? workspaceInfo(paths.workspaceDir) : { root: paths.workspaceDir, hasData: false },
      automation: automation?.status() ?? null,
      power: power?.status() ?? null,
      update: updater?.status() ?? null,
      ai: ai ? { ...ai.engine.status(), pipeline: ai.pipeline.status() } : null,
      telegram: telegram ? telegram.status() : null,
      integrations: integrations && unlocked ? integrations.viewAll() : null,
      mail: mail && unlocked ? mail.status() : null,
      lark: lark && unlocked ? lark.status() : null,
      digest: digest && unlocked ? digest.status() : null,
      suggestions: unlocked ? (suggestions?.summary() ?? null) : null,
      now: Date.now(),
    };
  });

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write(':ok\n\n');
    sseClients.add(reply.raw);
    const ping = setInterval(() => { try { reply.raw.write(':ping\n\n'); } catch { /* bỏ qua */ } }, 25000);
    req.raw.on('close', () => { clearInterval(ping); sseClients.delete(reply.raw); });
  });

  // ── Đăng nhập máy chủ xác thực (bridge giữ phiên) ─────────────────────────────
  app.post('/api/auth/login', withUi(async (req) => {
    const { email, password, serverUrl, resetData } = req.body ?? {};
    await auth.login({ email: String(email ?? '').trim(), password: String(password ?? ''), serverUrl });
    await guardOwner(auth.user?.id, !!resetData, () => auth.logout());
    await security.unlock({ syncWithServer: false });
    return { ok: true, auth: auth.publicState() };
  }));
  app.post('/api/auth/register', withUi(async (req) => {
    const { email, password, name, registrationCode, serverUrl, resetData } = req.body ?? {};
    await auth.register({ email: String(email ?? '').trim(), password: String(password ?? ''), name, registrationCode, serverUrl });
    await guardOwner(auth.user?.id, !!resetData, () => auth.logout());
    await security.unlock({ syncWithServer: false });
    return { ok: true, auth: auth.publicState() };
  }));
  app.post('/api/auth/forgot', withUi(async (req) => auth.forgotPassword(String(req.body?.email ?? '').trim(), req.body?.serverUrl)));
  app.post('/api/auth/reset', withUi(async (req) => auth.resetPassword(String(req.body?.email ?? '').trim(), String(req.body?.code ?? ''), String(req.body?.newPassword ?? ''), req.body?.serverUrl)));
  app.post('/api/auth/change-password', withUi(async (req) => auth.changePassword(String(req.body?.currentPassword ?? ''), String(req.body?.newPassword ?? ''))));
  // Chế độ DÙNG THỬ không máy chủ (máy không có Docker): danh tính + chuỗi mã hoá sinh cục bộ; dữ liệu chỉ đọc trên máy này.
  app.post('/api/auth/local', withUi(async (req) => {
    if (auth.isLoggedIn) throw Object.assign(new Error('Đang đăng nhập rồi.'), { status: 400 });
    await guardOwner('__danh-tinh-moi__', !!req.body?.resetData, null);
    auth.loginLocal({ name: req.body?.name });
    await security.unlock({ syncWithServer: false });
    return { ok: true, auth: auth.publicState() };
  }));
  // Đăng xuất: tài khoản máy chủ giữ dữ liệu (đăng nhập lại là đọc được); chế độ dùng thử thì khoá mất theo ⇒ xoá luôn dữ liệu thử.
  app.post('/api/auth/logout', withUi(async () => { const local = auth.mode === 'local'; security.lock(); if (local) security.resetData(); await auth.logout(); return { ok: true, wiped: local }; }));
  app.post('/api/auth/server-url', withUi(async (req) => ({ serverUrl: auth.setServerUrl(req.body?.url) })));
  app.get('/api/auth/ping', withUi(async (req) => ({ ok: true, server: await auth.ping(req.query?.url) })));

  // ── Bảo mật ──────────────────────────────────────────────────────────────────
  app.get('/api/security', async () => security.status());
  app.post('/api/security/rotate-key', withUi(async () => security.rotateKey()));
  app.post('/api/security/reencrypt', withUi(async () => { void security.reencryptNow(); return { ok: true }; }));

  // ── Tài khoản Zalo ───────────────────────────────────────────────────────────
  app.post('/api/accounts/login-qr', async () => manager.startQrLogin());
  app.get('/api/accounts/login-qr/:key', async (req) => manager.getQrStatus(req.params.key));
  app.post('/api/accounts/:id/start', async (req, reply) => { const r = await manager.start(req.params.id); return r.ok ? { ok: true } : reply.code(400).send(r); });
  app.post('/api/accounts/:id/stop', async (req) => { manager.stop(req.params.id); return { ok: true }; });
  app.post('/api/accounts/:id/logout', async (req) => { manager.logout(req.params.id); return { ok: true }; });
  app.post('/api/accounts/:id/sync-old', async (req, reply) => { const r = manager.requestOld(req.params.id); return r.ok ? r : reply.code(400).send(r); });
  app.post('/api/accounts/:id/import-groups', async (req, reply) => {
    const count = Number(req.body?.count ?? settings.load().groupHistoryCount ?? 300);
    const r = await manager.importGroupHistory(req.params.id, { count: Math.min(Math.max(count, 20), 2000) });
    return r.ok ? r : reply.code(400).send(r);
  });
  app.get('/api/accounts/:id/import-groups/status', async (req) => manager.getImportStatus(req.params.id) ?? { running: false });
  app.post('/api/accounts/:id/sync-contacts', async (req, reply) => { const r = await manager.syncContacts(req.params.id); return r.ok ? r : reply.code(400).send(r); });
  app.delete('/api/accounts/:id', async (req) => { manager.logout(req.params.id); db.deleteAccount(req.params.id); return { ok: true }; });

  // ── Hội thoại / tin nhắn ─────────────────────────────────────────────────────
  app.get('/api/conversations', async (req) => {
    const q = req.query ?? {};
    const s = settings.load();
    return db.listConversations({
      accountIds: q.accountId ? [q.accountId] : undefined,
      source: ['zalo', 'telegram', 'email', 'lark'].includes(q.source) ? q.source : undefined,
      q: q.q || undefined,
      onlyWaiting: q.waiting === 'true',
      onlyUnread: q.unread === 'true',
      onlyGroups: q.groups === 'true',
      includeGroups: q.includeGroups === undefined ? !!s.includeGroups : q.includeGroups === 'true',
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
      limit: q.limit ? Number(q.limit) : 200,
      offset: q.offset ? Number(q.offset) : 0,
    });
  });
  app.get('/api/conversations/:accountId/:threadId/messages', async (req) => {
    const { accountId, threadId } = req.params;
    const conv = db.getConversation(accountId, threadId);
    const limit = req.query?.limit ? Number(req.query.limit) : 60;
    const rows = db.getRecentMessages(accountId, threadId, { limit, before: req.query?.before ? Number(req.query.before) : null });
    const reactions = db.reactionsForMessages(accountId, threadId, rows.map((m) => m.zalo_msg_id).filter(Boolean), accountId);
    const avatars = db.contactAvatars(accountId, rows.map((m) => m.sender_id));
    const messages = rows.map((m) => ({ ...m, attachments: m.attachments_json ? safeJson(m.attachments_json) : [], reactions: reactions[m.zalo_msg_id] ?? [], sender_avatar: avatars[String(m.sender_id)] ?? null, raw_json: undefined }));
    // Lần tải đầu (không phân trang) kèm tóm tắt của Claude cho hội thoại này — cột trợ lý dùng.
    const claude = req.query?.before ? undefined : (() => { try { return claudeEntryFor(paths.workspaceDir, threadId); } catch { return null; } })();
    return { conversation: conv, messages, hasMore: rows.length >= limit, claude };
  });

  /** Đánh dấu đã đọc (cục bộ, như Zalo) — KHÔNG gửi trạng thái "đã xem" lên Zalo. */
  app.post('/api/conversations/:accountId/:threadId/read', async (req) => { const changed = db.markRead(req.params.accountId, req.params.threadId); if (changed) broadcast('status', { read: true }); return { ok: true }; });

  // ── Gửi tin & gợi ý của Claude ───────────────────────────────────────────────
  app.post('/api/conversations/:accountId/:threadId/send', withUi(async (req) => { if (/^(tg|mail|lark):/.test(String(req.params.accountId))) throw Object.assign(new Error('Nguồn này chỉ đọc (Telegram/Email/Lark) — không gửi từ ứng dụng.'), { status: 400 }); return manager.sendMessage(req.params.accountId, req.params.threadId, req.body?.text, { quoteMsgId: req.body?.quoteMsgId ? String(req.body.quoteMsgId) : null }); }));
  // Thả cảm xúc như Zalo: 6 cảm xúc chuẩn; icon rỗng = bỏ cảm xúc của mình.
  const REACTION_ICONS = ['/-heart', '/-strong', ':>', ':o', ':-((', ':-h'];
  // Sticker Zalo, ảnh/GIF/tệp từ máy, GIF Tenor
  app.get('/api/accounts/:id/stickers', withUi(async (req) => ({ items: await manager.searchStickers(req.params.id, req.query?.q) })));
  app.post('/api/conversations/:accountId/:threadId/sticker', withUi(async (req) => manager.sendSticker(req.params.accountId, req.params.threadId, req.body ?? {})));
  app.post('/api/conversations/:accountId/:threadId/attachments', withUi(async (req) => manager.sendAttachments(req.params.accountId, req.params.threadId, req.body?.paths, req.body?.caption)));
  app.post('/api/conversations/:accountId/:threadId/gif', withUi(async (req) => manager.sendGifFromUrl(req.params.accountId, req.params.threadId, req.body?.url)));
  app.post('/api/pick-files', withUi(async (req) => {
    if (typeof platform.pickFiles !== 'function') throw Object.assign(new Error('Chọn tệp chỉ có trong ứng dụng cài đặt (Electron).'), { status: 501 });
    const kind = req.body?.kind === 'image' ? 'image' : 'file';
    const filters = kind === 'image' ? [{ name: 'Ảnh & GIF', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }] : [{ name: 'Mọi tệp', extensions: ['*'] }];
    const paths = await platform.pickFiles({ filters, multi: true });
    return { paths: Array.isArray(paths) ? paths : [] };
  }));
  app.get('/api/gifs', withUi(async (req) => {
    const key = String(settings.load().gifApiKey ?? '').trim();
    if (!key) return { items: [], needsKey: true };
    const q = String(req.query?.q ?? '').trim();
    const u = q ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}&limit=24&media_filter=gif,tinygif&locale=vi_VN` : `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(key)}&limit=24&media_filter=gif,tinygif&locale=vi_VN`;
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Tenor trả lỗi ${res.status} — kiểm tra khoá API trong Cài đặt.`);
    const j = await res.json();
    return { items: (j.results ?? []).map((r) => ({ id: r.id, preview: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url, url: r.media_formats?.gif?.url, w: r.media_formats?.tinygif?.dims?.[0], h: r.media_formats?.tinygif?.dims?.[1] })).filter((x) => x.url) };
  }));
  // Tệp đã gửi từ máy (bản sao trong data/sent/) — chỉ tên tệp, không đường dẫn.
  app.get('/files/sent/:name', async (req, reply) => {
    const name = path.basename(String(req.params.name ?? ''));
    const p = path.join(paths.sentDir ?? path.join(paths.dataDir, 'sent'), name);
    if (!name || !fs.existsSync(p)) return reply.code(404).send({ error: 'Không có tệp.' });
    const ext = path.extname(name).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.pdf': 'application/pdf' }[ext] ?? 'application/octet-stream';
    reply.header('Cache-Control', 'private, max-age=86400').type(mime);
    return reply.send(fs.createReadStream(p));
  });
  app.post('/api/conversations/:accountId/:threadId/messages/:msgId/forward', withUi(async (req) => manager.forwardMessage(req.params.accountId, req.params.threadId, req.params.msgId, req.body?.targets)));
  app.post('/api/conversations/:accountId/:threadId/messages/:msgId/react', withUi(async (req) => {
    const icon = String(req.body?.icon ?? '');
    if (icon && !REACTION_ICONS.includes(icon)) throw Object.assign(new Error('Cảm xúc không hợp lệ.'), { status: 400 });
    return manager.addReaction(req.params.accountId, req.params.threadId, req.params.msgId, icon);
  }));
  app.get('/api/suggestions', async () => suggestions?.all() ?? { count: 0, items: [] });
  app.post('/api/suggestions/refresh', async () => suggestions?.refresh() ?? { count: 0 });
  app.get('/api/conversations/:accountId/:threadId/suggestions', async (req) => suggestions?.forThread(req.params.accountId, req.params.threadId) ?? []);

  // ── Báo cáo ngày ─────────────────────────────────────────────────────────────
  app.get('/api/report/dates', async () => ({ today: dayKeyVn(Date.now()), dates: listReportDates(paths.workspaceDir, db) }));
  app.get('/api/report', withUi(async (req) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.date ?? '')) ? req.query.date : dayKeyVn(Date.now());
    return loadReport(paths.workspaceDir, db, date);
  }));

  // ── Thư mục làm việc với Claude ──────────────────────────────────────────────
  app.get('/api/workspace', async () => workspaceInfo(paths.workspaceDir));
  app.post('/api/workspace/update', withUi(async (req, reply) => {
    const body = req.body ?? {};
    const s = settings.load();
    const params = presetParams(body.preset ?? s.defaultPreset ?? 'waiting', body, s);
    const r = await updateWorkspaceData({ db, params, root: paths.workspaceDir, log, settings: s, gaps: power?.recentGaps?.(48) ?? [] });
    return r.ok ? r : reply.code(400).send(r);
  }));
  app.post('/api/workspace/clear', async () => clearWorkspaceData(paths.workspaceDir));
  app.post('/api/workspace/auto-run', withUi(async () => (await automation?.run('thủ công')) ?? { ok: false, error: 'Không chạy được.' }));
  /** Tương thích CLI/cũ: xuất = cập nhật thư mục làm việc. */
  app.post('/api/export', withUi(async (req, reply) => {
    const body = req.body ?? {};
    const s = settings.load();
    const params = presetParams(body.preset ?? (body.onlyWaiting ? 'waiting' : 'custom'), body, s);
    const r = await updateWorkspaceData({ db, params, root: paths.workspaceDir, log, settings: s, gaps: power?.recentGaps?.(48) ?? [] });
    return r.ok ? r : reply.code(400).send(r);
  }));

  app.post('/api/open', async (req, reply) => {
    const p = req.body?.path;
    if (!p || !withinAllowed(p) || !fs.existsSync(p)) return reply.code(400).send({ ok: false, error: 'Đường dẫn không hợp lệ.' });
    platform.revealPath(p);
    return { ok: true };
  });

  /** Mở một địa chỉ web bằng trình duyệt mặc định (nút "Tải về" của thanh cập nhật). CHỈ nhận http(s). */
  app.post('/api/open-url', async (req, reply) => {
    const url = String(req.body?.url ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048) return reply.code(400).send({ ok: false, error: 'Địa chỉ không hợp lệ (chỉ mở được http:// hoặc https://).' });
    if (typeof platform.openExternal === 'function') { platform.openExternal(url); return { ok: true, via: 'electron' }; }
    if (process.platform === 'darwin') { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); return { ok: true, via: 'open' }; }
    return reply.code(501).send({ ok: false, error: 'Máy này chưa mở được liên kết từ ứng dụng — hãy chép địa chỉ và dán vào trình duyệt.' });
  });

  // ── Kiểm tra bản cập nhật ────────────────────────────────────────────────────
  app.post('/api/updates/check', withUi(async () => {
    if (!updater) throw Object.assign(new Error('Chưa bật kiểm tra cập nhật.'), { status: 501 });
    return updater.check({ manual: true });
  }));
  app.post('/api/updates/skip', withUi(async (req) => {
    if (!updater) throw Object.assign(new Error('Chưa bật kiểm tra cập nhật.'), { status: 501 });
    return updater.skip(req.body?.version);
  }));
  // Tải bộ cài trong ứng dụng (chạy nền, theo dõi tiến độ qua status) rồi cài + mở lại. Node thuần trả 501 ⇒ giao diện mở trình duyệt.
  app.get('/api/updates/status', withUi(async () => {
    if (!updater) throw Object.assign(new Error('Chưa bật kiểm tra cập nhật.'), { status: 501 });
    return updater.status();
  }));
  app.post('/api/updates/download', withUi(async () => {
    if (!updater) throw Object.assign(new Error('Chưa bật kiểm tra cập nhật.'), { status: 501 });
    return updater.download();
  }));
  app.post('/api/updates/install', withUi(async () => {
    if (!updater) throw Object.assign(new Error('Chưa bật kiểm tra cập nhật.'), { status: 501 });
    return updater.install();
  }));

  // ── Bộ máy AI cục bộ (model chạy trong ứng dụng) ─────────────────────────────
  const aiStatus = () => ({ ...ai.engine.status(), pipeline: ai.pipeline.status() });
  const needAi = () => { if (!ai) throw Object.assign(new Error('Bộ máy AI chưa sẵn sàng.'), { status: 501 }); };
  app.get('/api/ai/status', withUi(async () => { needAi(); return aiStatus(); }));
  app.get('/api/ai/models', withUi(async () => { needAi(); return { items: KNOWN_MODELS, local: listLocalModels(ai.engine.modelsDir) }; }));
  app.post('/api/ai/model/download', withUi(async (req) => {
    needAi();
    const url = String(req.body?.url || settings.load().aiModelUrl || '').trim();
    if (!/^https:\/\/[^\s]+\.gguf$/i.test(url)) throw Object.assign(new Error('URL model không hợp lệ.'), { status: 400 });
    void ai.engine.download({ url });
    return aiStatus();
  }));
  app.post('/api/ai/model/cancel', withUi(async () => { needAi(); ai.engine.cancelDownload(); return aiStatus(); }));
  app.post('/api/ai/run', withUi(async (req) => { needAi(); void ai.pipeline.run({ reason: 'người dùng bấm', force: !!req.body?.force }); return aiStatus(); }));
  app.post('/api/ai/unload', withUi(async () => { needAi(); await ai.engine.unload('người dùng bấm'); return aiStatus(); }));

  // ── Telegram tài khoản cá nhân (chỉ đọc) ─────────────────────────────────────
  const needTg = () => { if (!telegram) throw Object.assign(new Error('Telegram chưa sẵn sàng.'), { status: 501 }); };
  app.get('/api/telegram/status', withUi(async () => { needTg(); return telegram.status(); }));
  app.post('/api/telegram/config', withUi(async (req) => { needTg(); return telegram.configure({ apiId: req.body?.apiId, apiHash: req.body?.apiHash }); }));
  app.post('/api/telegram/login', withUi(async (req) => { needTg(); return telegram.startLogin(req.body?.phone); }));
  app.post('/api/telegram/login/code', withUi(async (req) => { needTg(); return telegram.submitCode(req.body?.code); }));
  app.post('/api/telegram/login/password', withUi(async (req) => { needTg(); return telegram.submitPassword(req.body?.password); }));
  app.post('/api/telegram/login/cancel', withUi(async () => { needTg(); return telegram.cancelLogin(); }));
  app.post('/api/telegram/logout', withUi(async () => { needTg(); return telegram.logout(); }));
  app.get('/api/telegram/dialogs', withUi(async () => { needTg(); return { items: await telegram.listDialogs() }; }));
  app.post('/api/telegram/watch', withUi(async (req) => { needTg(); return telegram.setWatched({ chatIds: Array.isArray(req.body?.chatIds) ? req.body.chatIds : [], titles: req.body?.titles ?? {}, historyDays: req.body?.historyDays }); }));
  app.post('/api/telegram/sync', withUi(async () => { needTg(); void telegram.syncHistory(); return telegram.status(); }));

  // ── Khoá tích hợp khác: Email IMAP, Lark Approval, bot Telegram gửi bản tin ─
  const needInt = () => { if (!integrations) throw Object.assign(new Error('Kho cấu hình chưa sẵn sàng.'), { status: 501 }); if (!security.unlocked) throw Object.assign(new Error('Cần đăng nhập để xem cấu hình.'), { status: 401 }); };
  app.get('/api/integrations', withUi(async () => { needInt(); return integrations.viewAll(); }));
  app.get('/api/integrations/:kind', withUi(async (req) => { needInt(); return integrations.view(req.params.kind); }));
  app.post('/api/integrations/:kind', withUi(async (req) => { needInt(); const v = integrations.set(req.params.kind, req.body ?? {}); broadcast('integrations', integrations.viewAll()); return v; }));
  // Thân request = giá trị đang gõ trên biểu mẫu (+ sendTest): kiểm bằng giá trị đó, OK mới lưu. Thân rỗng = kiểm bản đã lưu.
  // ── Email IMAP · Lark Approval · Bản tin giọng nói ──────────────────────────
  const needMail = () => { if (!mail) throw Object.assign(new Error('Email chưa sẵn sàng.'), { status: 501 }); };
  app.get('/api/mail/status', withUi(async () => { needMail(); return mail.status(); }));
  app.post('/api/mail/sync', withUi(async () => { needMail(); void mail.sync('tay'); return mail.status(); }));
  const needLark = () => { if (!lark) throw Object.assign(new Error('Lark chưa sẵn sàng.'), { status: 501 }); };
  app.get('/api/lark/status', withUi(async () => { needLark(); return lark.status(); }));
  app.post('/api/lark/sync', withUi(async () => { needLark(); void lark.sync('tay'); return lark.status(); }));
  const needDigest = () => { if (!digest) throw Object.assign(new Error('Bản tin chưa sẵn sàng.'), { status: 501 }); };
  app.get('/api/digest/status', withUi(async () => { needDigest(); return digest.status(); }));
  app.post('/api/digest/preview', withUi(async (req) => { needDigest(); return digest.sendNow('xem trước', { preview: true, skipRefresh: !req.body?.refresh }); }));
  app.post('/api/digest/send', withUi(async (req) => { needDigest(); void digest.sendNow('người dùng bấm', { skipRefresh: !!req.body?.skipRefresh }); return digest.status(); }));
  app.post('/api/integrations/:kind/test', withUi(async (req) => { needInt(); const { sendTest, ...patch } = req.body ?? {}; const v = await integrations.test(req.params.kind, { sendTest: !!sendTest, patch: Object.keys(patch).length ? patch : null }); broadcast('integrations', integrations.viewAll()); return v; }));

  // Sao chép vào clipboard hệ thống: trình duyệt nhúng có thể chặn navigator.clipboard → giao diện gọi về đây.
  app.post('/api/clipboard', async (req, reply) => {
    const text = String(req.body?.text ?? '');
    if (text.length > 200_000) return reply.code(400).send({ ok: false, error: 'Nội dung quá dài.' });
    if (typeof platform.copyText === 'function') { platform.copyText(text); return { ok: true, via: 'electron' }; }
    if (process.platform === 'darwin') {
      await new Promise((res, rej) => { const p = spawn('pbcopy'); p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error('pbcopy trả mã ' + c)))); p.stdin.end(text); });
      return { ok: true, via: 'pbcopy' };
    }
    return reply.code(501).send({ ok: false, error: 'Máy này chưa hỗ trợ sao chép từ ứng dụng.' });
  });


  // ── Thiết lập / nhật ký ─────────────────────────────────────────────────────
  app.get('/api/settings', async () => settings.load());
  app.post('/api/settings', async (req, reply) => {
    const body = req.body ?? {};
    const patch = {};
    for (const k of ['includeGroups', 'syncOldOnConnect', 'includeExcel', 'keepAwake', 'autoCheckUpdates']) if (typeof body[k] === 'boolean') patch[k] = body[k];
    if (typeof body.updateServerUrl === 'string') {
      const u = body.updateServerUrl.trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s]+$/.test(u)) return reply.code(400).send({ error: 'Địa chỉ máy chủ cập nhật không hợp lệ (để trống, hoặc bắt đầu bằng http:// hoặc https://).' });
      patch.updateServerUrl = u;
    }
    if (Number.isFinite(Number(body.waitingHours))) patch.waitingHours = Math.max(0, Number(body.waitingHours));
    if (Number.isFinite(Number(body.groupHistoryCount))) patch.groupHistoryCount = Math.min(Math.max(Number(body.groupHistoryCount), 20), 2000);
    if (typeof body.defaultPreset === 'string' && ['waiting', 'today', 'week', 'groups', 'all'].includes(body.defaultPreset)) patch.defaultPreset = body.defaultPreset;
    if (Number.isFinite(Number(body.autoUpdateMinutes))) patch.autoUpdateMinutes = Math.min(Math.max(Math.round(Number(body.autoUpdateMinutes)), 0), 1440);
    if (typeof body.aiEngine === 'string' && ['local', 'cowork'].includes(body.aiEngine)) patch.aiEngine = body.aiEngine;
    if (typeof body.aiModelUrl === 'string') {
      const u = body.aiModelUrl.trim();
      if (u && !/^https:\/\/[^\s]+\.gguf$/i.test(u)) return reply.code(400).send({ error: 'URL model phải là https:// và kết thúc bằng .gguf.' });
      if (u) patch.aiModelUrl = u;
    }
    if (typeof body.aiModelPath === 'string') patch.aiModelPath = body.aiModelPath.trim();
    if (Number.isFinite(Number(body.aiContextSize))) patch.aiContextSize = Math.min(Math.max(Math.round(Number(body.aiContextSize)), 2048), 32768);
    if (Number.isFinite(Number(body.aiIdleUnloadMinutes))) patch.aiIdleUnloadMinutes = Math.min(Math.max(Math.round(Number(body.aiIdleUnloadMinutes)), 0), 1440);
    if (Number.isFinite(Number(body.quietMinutes))) patch.quietMinutes = Math.min(Math.max(Math.round(Number(body.quietMinutes)), 0), 120);
    const saved = settings.save(patch);
    automation?.schedule();
    power?.applyKeepAwake();
    // Đổi máy chủ cập nhật / công tắc tự kiểm tra ⇒ đặt lại chu kỳ (không kiểm tra ngay, để người dùng tự bấm).
    if (patch.updateServerUrl !== undefined || patch.autoCheckUpdates !== undefined) updater?.schedule({ initial: false });
    if (typeof body.gifApiKey === 'string') { const k = body.gifApiKey.trim().slice(0, 120); settings.save({ gifApiKey: k }); }
    if (typeof body.autoStart === 'boolean') platform.setAutoStart(body.autoStart);
    return { ...saved, autoStart: platform.getAutoStart() };
  });
  app.get('/api/logs', async (req) => log.recent(req.query?.n ? Number(req.query.n) : 120));

  app.setErrorHandler((err, _req, reply) => {
    log.error(`HTTP lỗi: ${err?.stack ?? err}`);
    reply.code(err.statusCode ?? 500).send({ ok: false, error: err?.message ?? 'Lỗi không xác định' });
  });

  return app;
}

function safeJson(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }
