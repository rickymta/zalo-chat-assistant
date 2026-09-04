/**
 * Máy chủ HTTP cục bộ (Fastify) — phục vụ giao diện và API cho chính máy này.
 *
 * CHỈ nghe 127.0.0.1. Không có xác thực vì không bao giờ mở ra mạng ngoài; đừng đổi HOST thành 0.0.0.0.
 * `platform` là móc nối tuỳ môi trường (Electron cung cấp: tự chạy khi bật máy, mở Finder…); chạy bằng Node
 * thuần thì dùng bản mặc định bên dưới.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import { runExport } from './export/index.js';

const defaultPlatform = {
  name: 'node',
  revealPath(p) { spawn('open', [p], { stdio: 'ignore', detached: true }).unref(); },
  getAutoStart() { return null; },          // null = không hỗ trợ ở chế độ này
  setAutoStart() { return null; },
  appVersion: null,
};

export function buildServer({ db, manager, log, settings, paths, platform = defaultPlatform }) {
  // forceCloseConnections: kết nối SSE (/api/events) là keep-alive vô hạn — không ép đóng thì server.close()
  // treo mãi và ứng dụng KHÔNG thoát được (⌘Q bị kẹt).
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, forceCloseConnections: true });
  const sseClients = new Set();

  // Chấp nhận body RỖNG với application/json (nút bấm gửi POST không kèm dữ liệu) — mặc định Fastify trả 400.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err, undefined); }
  });

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  }
  manager.on('message', (d) => broadcast('message', d));
  manager.on('status', (d) => broadcast('status', d));
  manager.on('qr', (d) => broadcast('qr', d));
  manager.on('progress', (d) => broadcast('progress', d));
  app.addHook('onClose', async () => { for (const res of sseClients) { try { res.end(); } catch { /* bỏ qua */ } } sseClients.clear(); });

  const withinAllowed = (p) => {
    const r = path.resolve(p);
    return [paths.dataDir, paths.exportsDir].some((base) => r === base || r.startsWith(base + path.sep));
  };

  // ── Giao diện ────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    const html = fs.readFileSync(path.join(paths.uiDir, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ── Trạng thái tổng ──────────────────────────────────────────────────────────
  app.get('/api/state', async () => {
    const accounts = db.listAccounts().map((a) => ({
      id: a.id, displayName: a.display_name, avatarUrl: a.avatar_url, phone: a.phone,
      status: manager.isLive(a.id) ? (a.status === 'reconnecting' ? 'reconnecting' : 'connected') : a.status,
      lastError: a.last_error, hasSession: !!manager.readSession(a.id),
      groupsImportedAt: a.groups_imported_at ?? null,
      importJob: manager.getImportStatus(a.id),
    }));
    return {
      accounts,
      stats: db.stats(),
      settings: settings.load(),
      paths: { dataDir: paths.dataDir, exportsDir: paths.exportsDir },
      platform: { name: platform.name, autoStart: platform.getAutoStart(), version: platform.appVersion },
      now: Date.now(),
    };
  });

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(':ok\n\n');
    sseClients.add(reply.raw);
    const ping = setInterval(() => { try { reply.raw.write(':ping\n\n'); } catch { /* bỏ qua */ } }, 25000);
    req.raw.on('close', () => { clearInterval(ping); sseClients.delete(reply.raw); });
  });

  // ── Tài khoản ────────────────────────────────────────────────────────────────
  app.post('/api/accounts/login-qr', async () => manager.startQrLogin());
  app.get('/api/accounts/login-qr/:key', async (req) => manager.getQrStatus(req.params.key));
  app.post('/api/accounts/:id/start', async (req, reply) => {
    const r = await manager.start(req.params.id);
    return r.ok ? { ok: true } : reply.code(400).send(r);
  });
  app.post('/api/accounts/:id/stop', async (req) => { manager.stop(req.params.id); return { ok: true }; });
  app.post('/api/accounts/:id/logout', async (req) => { manager.logout(req.params.id); return { ok: true }; });
  app.post('/api/accounts/:id/sync-old', async (req, reply) => {
    const r = manager.requestOld(req.params.id);
    return r.ok ? r : reply.code(400).send(r);
  });
  app.post('/api/accounts/:id/import-groups', async (req, reply) => {
    const count = Number(req.body?.count ?? settings.load().groupHistoryCount ?? 300);
    const r = await manager.importGroupHistory(req.params.id, { count: Math.min(Math.max(count, 20), 2000) });
    return r.ok ? r : reply.code(400).send(r);
  });
  app.get('/api/accounts/:id/import-groups/status', async (req) => manager.getImportStatus(req.params.id) ?? { running: false });
  app.post('/api/accounts/:id/sync-contacts', async (req, reply) => {
    const r = await manager.syncContacts(req.params.id);
    return r.ok ? r : reply.code(400).send(r);
  });
  /** Gỡ tài khoản khỏi danh sách (tin nhắn giữ nguyên trong CSDL). */
  app.delete('/api/accounts/:id', async (req) => {
    manager.logout(req.params.id);
    db.deleteAccount(req.params.id);
    return { ok: true };
  });

  // ── Hội thoại / tin nhắn ─────────────────────────────────────────────────────
  app.get('/api/conversations', async (req) => {
    const q = req.query ?? {};
    const s = settings.load();
    const includeGroups = q.includeGroups === undefined ? !!s.includeGroups : q.includeGroups === 'true';
    return db.listConversations({
      accountIds: q.accountId ? [q.accountId] : undefined,
      q: q.q || undefined,
      onlyWaiting: q.waiting === 'true',
      onlyGroups: q.groups === 'true',
      includeGroups,
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
      limit: q.limit ? Number(q.limit) : 200,
      offset: q.offset ? Number(q.offset) : 0,
    });
  });
  app.get('/api/conversations/:accountId/:threadId/messages', async (req) => {
    const { accountId, threadId } = req.params;
    const conv = db.getConversation(accountId, threadId);
    const messages = db.getRecentMessages(accountId, threadId, {
      limit: req.query?.limit ? Number(req.query.limit) : 300,
      before: req.query?.before ? Number(req.query.before) : null,
    }).map((m) => ({ ...m, attachments: m.attachments_json ? JSON.parse(m.attachments_json) : [], raw_json: undefined }));
    return { conversation: conv, messages };
  });

  // ── Xuất ─────────────────────────────────────────────────────────────────────
  app.post('/api/export', async (req, reply) => {
    const body = req.body ?? {};
    const s = settings.load();
    const params = {
      formats: Array.isArray(body.formats) ? body.formats : ['markdown'],
      accountIds: Array.isArray(body.accountIds) && body.accountIds.length ? body.accountIds : undefined,
      from: body.from ? Number(body.from) : null,
      to: body.to ? Number(body.to) : null,
      includeGroups: body.includeGroups === undefined ? !!s.includeGroups : !!body.includeGroups,
      onlyWaiting: !!body.onlyWaiting,
      onlyGroups: !!body.onlyGroups,
      fullHistory: !!body.fullHistory,
      threadIds: Array.isArray(body.threadIds) && body.threadIds.length ? body.threadIds : undefined,
      includeJsonl: !!body.includeJsonl,
    };
    try {
      const r = await runExport({ db, params, exportsDir: paths.exportsDir, coworkDir: paths.coworkDir, log, settings: s });
      return r.ok ? r : reply.code(400).send(r);
    } catch (err) {
      log.error(`Xuất thất bại: ${err?.stack ?? err}`);
      return reply.code(500).send({ ok: false, error: err?.message ?? String(err) });
    }
  });
  app.get('/api/exports', async () => db.listExports().map((e) => ({ ...e, exists: fs.existsSync(e.dir) })));

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
    if (typeof body.includeGroups === 'boolean') patch.includeGroups = body.includeGroups;
    if (typeof body.syncOldOnConnect === 'boolean') patch.syncOldOnConnect = body.syncOldOnConnect;
    if (Number.isFinite(Number(body.waitingHours))) patch.waitingHours = Math.max(0, Number(body.waitingHours));
    if (Number.isFinite(Number(body.groupHistoryCount))) patch.groupHistoryCount = Math.min(Math.max(Number(body.groupHistoryCount), 20), 2000);
    const saved = settings.save(patch);
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
