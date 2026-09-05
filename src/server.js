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

export function buildServer({ db, manager, log, settings, paths, platform = defaultPlatform, auth, security, events, automation, suggestions, power, updater }) {
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
    const accounts = unlocked ? db.listAccounts().map((a) => ({
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
    const messages = rows.map((m) => ({ ...m, attachments: m.attachments_json ? safeJson(m.attachments_json) : [], reactions: reactions[m.zalo_msg_id] ?? [], raw_json: undefined }));
    // Lần tải đầu (không phân trang) kèm tóm tắt của Claude cho hội thoại này — cột trợ lý dùng.
    const claude = req.query?.before ? undefined : (() => { try { return claudeEntryFor(paths.workspaceDir, threadId); } catch { return null; } })();
    return { conversation: conv, messages, hasMore: rows.length >= limit, claude };
  });

  /** Đánh dấu đã đọc (cục bộ, như Zalo) — KHÔNG gửi trạng thái "đã xem" lên Zalo. */
  app.post('/api/conversations/:accountId/:threadId/read', async (req) => { const changed = db.markRead(req.params.accountId, req.params.threadId); if (changed) broadcast('status', { read: true }); return { ok: true }; });

  // ── Gửi tin & gợi ý của Claude ───────────────────────────────────────────────
  app.post('/api/conversations/:accountId/:threadId/send', withUi(async (req) => manager.sendMessage(req.params.accountId, req.params.threadId, req.body?.text)));
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

  // ── Tin nhắn mẫu (cột trợ lý): người dùng tự soạn/sửa, lưu data/templates.json; [tên] được thay bằng tên người đối thoại.
  const TPL_FILE = path.join(paths.dataDir, 'templates.json');
  const DEFAULT_TEMPLATES = [
    { id: 'tpl-chao', title: 'Chào và nhận yêu cầu', text: 'Chào [tên], em là tư vấn viên MedDental. Em đã nhận được tin của mình, em kiểm tra và phản hồi ngay ạ.' },
    { id: 'tpl-cho', title: 'Xin phép trả lời sau', text: 'Dạ [tên], em đang kiểm tra thông tin với bác sĩ, em sẽ báo lại mình trong [thời gian] nhé. Cảm ơn mình đã chờ ạ.' },
    { id: 'tpl-xin-info', title: 'Xin thêm ảnh / số điện thoại', text: 'Để em tư vấn chính xác hơn, mình cho em xin thêm ảnh răng (chụp rõ, đủ sáng) và số điện thoại liên hệ được không ạ?' },
    { id: 'tpl-xac-nhan-lich', title: 'Xác nhận lịch hẹn', text: 'Em xác nhận lịch hẹn của [tên]: [ngày] lúc [giờ] tại MedDental [cơ sở]. Mình đến sớm 5–10 phút để làm thủ tục nhé. Có thay đổi mình nhắn em ạ.' },
    { id: 'tpl-nhac-lich', title: 'Nhắc lịch trước ngày khám', text: 'Em nhắc [tên] mai [giờ] mình có lịch tại MedDental [cơ sở] ạ. Mình vẫn đến được đúng giờ chứ ạ? Nếu bận em đổi giúp mình khung khác nhé.' },
    { id: 'tpl-dia-chi', title: 'Gửi địa chỉ cơ sở', text: 'Cơ sở gần mình nhất là MedDental [cơ sở], địa chỉ: [địa chỉ]. Giờ làm việc 7h–17h hằng ngày ạ. Em gửi vị trí để mình tiện đi nhé.' },
    { id: 'tpl-theo-doi', title: 'Hỏi lại nhẹ (theo dõi)', text: 'Dạ [tên], hôm trước mình có hỏi về [chủ đề], mình còn quan tâm không ạ? Nếu tiện em giữ cho mình một khung giờ khám tư vấn nhé.' },
    { id: 'tpl-cam-on', title: 'Cảm ơn sau khám', text: 'Cảm ơn [tên] đã tin tưởng MedDental ạ. Có gì khó chịu sau khám mình nhắn em ngay nhé, em luôn ở đây để hỗ trợ ạ.' },
  ];
  const loadTemplates = () => { try { const j = JSON.parse(fs.readFileSync(TPL_FILE, 'utf8')); if (Array.isArray(j.items)) return j.items; } catch { /* chưa có */ } return DEFAULT_TEMPLATES; };
  app.get('/api/templates', async () => ({ items: loadTemplates(), isDefault: !fs.existsSync(TPL_FILE) }));
  app.post('/api/templates', async (req, reply) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length > 100) return reply.code(400).send({ ok: false, error: 'Danh sách mẫu không hợp lệ.' });
    const clean = items.map((t, i) => ({ id: String(t?.id || ('tpl-' + Date.now() + '-' + i)), title: String(t?.title ?? '').trim().slice(0, 80), text: String(t?.text ?? '').trim().slice(0, 2000) })).filter((t) => t.title && t.text);
    fs.writeFileSync(TPL_FILE, JSON.stringify({ items: clean }, null, 2));
    return { ok: true, items: clean };
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
    if (Number.isFinite(Number(body.quietMinutes))) patch.quietMinutes = Math.min(Math.max(Math.round(Number(body.quietMinutes)), 0), 120);
    const saved = settings.save(patch);
    automation?.schedule();
    power?.applyKeepAwake();
    // Đổi máy chủ cập nhật / công tắc tự kiểm tra ⇒ đặt lại chu kỳ (không kiểm tra ngay, để người dùng tự bấm).
    if (patch.updateServerUrl !== undefined || patch.autoCheckUpdates !== undefined) updater?.schedule({ initial: false });
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
