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

export function buildServer({ db, manager, log, settings, paths, platform = defaultPlatform, auth, security, events, automation, suggestions }) {
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
  app.addHook('onClose', async () => { for (const res of sseClients) { try { res.end(); } catch { /* bỏ qua */ } } sseClients.clear(); });

  // ── Gác khoá: chưa mở khoá thì chỉ cho các đường công khai ─────────────────────
  const OPEN_PREFIXES = ['/api/auth/', '/api/events', '/api/logs', '/api/state', '/api/settings'];
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
  const withUi = (fn) => async (req, reply) => { try { return await fn(req, reply); } catch (err) { return reply.code(err.status ?? err.statusCode ?? 400).send({ error: err.message ?? String(err) }); } };

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
    const { email, password, serverUrl } = req.body ?? {};
    await auth.login({ email: String(email ?? '').trim(), password: String(password ?? ''), serverUrl });
    await security.unlock({ syncWithServer: false });
    return { ok: true, auth: auth.publicState() };
  }));
  app.post('/api/auth/register', withUi(async (req) => {
    const { email, password, name, registrationCode, serverUrl } = req.body ?? {};
    await auth.register({ email: String(email ?? '').trim(), password: String(password ?? ''), name, registrationCode, serverUrl });
    await security.unlock({ syncWithServer: false });
    return { ok: true, auth: auth.publicState() };
  }));
  app.post('/api/auth/forgot', withUi(async (req) => auth.forgotPassword(String(req.body?.email ?? '').trim(), req.body?.serverUrl)));
  app.post('/api/auth/reset', withUi(async (req) => auth.resetPassword(String(req.body?.email ?? '').trim(), String(req.body?.code ?? ''), String(req.body?.newPassword ?? ''), req.body?.serverUrl)));
  app.post('/api/auth/change-password', withUi(async (req) => auth.changePassword(String(req.body?.currentPassword ?? ''), String(req.body?.newPassword ?? ''))));
  app.post('/api/auth/logout', withUi(async () => { security.lock(); await auth.logout(); return { ok: true }; }));
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
    const messages = db.getRecentMessages(accountId, threadId, { limit: req.query?.limit ? Number(req.query.limit) : 300, before: req.query?.before ? Number(req.query.before) : null })
      .map((m) => ({ ...m, attachments: m.attachments_json ? safeJson(m.attachments_json) : [], raw_json: undefined }));
    return { conversation: conv, messages };
  });

  // ── Gửi tin & gợi ý của Claude ───────────────────────────────────────────────
  app.post('/api/conversations/:accountId/:threadId/send', withUi(async (req) => manager.sendMessage(req.params.accountId, req.params.threadId, req.body?.text)));
  app.get('/api/suggestions', async () => suggestions?.all() ?? { count: 0, items: [] });
  app.post('/api/suggestions/refresh', async () => suggestions?.refresh() ?? { count: 0 });
  app.get('/api/conversations/:accountId/:threadId/suggestions', async (req) => suggestions?.forThread(req.params.accountId, req.params.threadId) ?? []);

  // ── Thư mục làm việc với Claude ──────────────────────────────────────────────
  app.get('/api/workspace', async () => workspaceInfo(paths.workspaceDir));
  app.post('/api/workspace/update', withUi(async (req, reply) => {
    const body = req.body ?? {};
    const s = settings.load();
    const params = presetParams(body.preset ?? s.defaultPreset ?? 'waiting', body, s);
    const r = await updateWorkspaceData({ db, params, root: paths.workspaceDir, log, settings: s });
    return r.ok ? r : reply.code(400).send(r);
  }));
  app.post('/api/workspace/clear', async () => clearWorkspaceData(paths.workspaceDir));
  app.post('/api/workspace/auto-run', withUi(async () => (await automation?.run('thủ công')) ?? { ok: false, error: 'Không chạy được.' }));
  /** Tương thích CLI/cũ: xuất = cập nhật thư mục làm việc. */
  app.post('/api/export', withUi(async (req, reply) => {
    const body = req.body ?? {};
    const s = settings.load();
    const params = presetParams(body.preset ?? (body.onlyWaiting ? 'waiting' : 'custom'), body, s);
    const r = await updateWorkspaceData({ db, params, root: paths.workspaceDir, log, settings: s });
    return r.ok ? r : reply.code(400).send(r);
  }));

  app.post('/api/open', async (req, reply) => {
    const p = req.body?.path;
    if (!p || !withinAllowed(p) || !fs.existsSync(p)) return reply.code(400).send({ ok: false, error: 'Đường dẫn không hợp lệ.' });
    platform.revealPath(p);
    return { ok: true };
  });

  // ── Thiết lập / nhật ký ─────────────────────────────────────────────────────
  app.get('/api/settings', async () => settings.load());
  app.post('/api/settings', async (req) => {
    const body = req.body ?? {};
    const patch = {};
    for (const k of ['includeGroups', 'syncOldOnConnect', 'includeExcel']) if (typeof body[k] === 'boolean') patch[k] = body[k];
    if (Number.isFinite(Number(body.waitingHours))) patch.waitingHours = Math.max(0, Number(body.waitingHours));
    if (Number.isFinite(Number(body.groupHistoryCount))) patch.groupHistoryCount = Math.min(Math.max(Number(body.groupHistoryCount), 20), 2000);
    if (typeof body.defaultPreset === 'string' && ['waiting', 'today', 'week', 'groups', 'all'].includes(body.defaultPreset)) patch.defaultPreset = body.defaultPreset;
    if (Number.isFinite(Number(body.autoUpdateMinutes))) patch.autoUpdateMinutes = Math.min(Math.max(Math.round(Number(body.autoUpdateMinutes)), 0), 1440);
    if (Number.isFinite(Number(body.quietMinutes))) patch.quietMinutes = Math.min(Math.max(Math.round(Number(body.quietMinutes)), 0), 120);
    const saved = settings.save(patch);
    automation?.schedule();
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
