/**
 * Lõi ứng dụng — dùng chung cho hai cách chạy:
 *  - `node src/index.js`  → mở giao diện trong trình duyệt (dành cho người kỹ thuật / máy dev)
 *  - Electron (`electron/main.js`) → cửa sổ ứng dụng macOS, không cần cài Node
 *
 * Trình tự khởi động: mở SQLite → HTTP cục bộ (bridge) → nếu data/auth.json còn phiên ⇒ MỞ KHOÁ (đặt khoá mã hoá
 * vào db) ⇒ khôi phục phiên Zalo ⇒ mã hoá lại phần dữ liệu còn ở phiên bản cũ (nền). Chưa đăng nhập ⇒ chỉ phục vụ
 * màn đăng nhập; Zalo KHÔNG được kết nối vì không có khoá để lưu tin.
 */
import { EventEmitter } from 'node:events';
import {
  ensureDirs, loadSettings, saveSettings,
  DATA_DIR, SESSIONS_DIR, DB_PATH, LOG_PATH, COWORK_DIR, WORKSPACE_DIR, UI_DIR, AUTH_FILE, DEFAULT_SERVER_URL, PORT, HOST,
} from './config.js';
import { createLogger } from './logger.js';
import { openDb } from './db.js';
import { ZaloManager } from './zalo/manager.js';
import { buildServer } from './server.js';
import { AuthClient } from './auth/client.js';
import { Cipher } from './crypto/cipher.js';
import { ensureWorkspace, updateWorkspaceData } from './workspace.js';
import { presetParams } from './server.js';
import { SuggestionStore } from './suggestions.js';

export async function startApp({ platform, port = PORT } = {}) {
  ensureDirs();
  const log = createLogger(LOG_PATH);
  const db = openDb(DB_PATH);
  const settings = { load: loadSettings, save: saveSettings };
  const manager = new ZaloManager({ db, log, sessionsDir: SESSIONS_DIR, getSettings: loadSettings });
  const auth = new AuthClient({ authFile: AUTH_FILE, log, defaultServerUrl: DEFAULT_SERVER_URL });
  const cipher = new Cipher();
  cipher.onWarn = (m) => log.warn(`Mã hoá: ${m}`);
  const events = new EventEmitter();
  auth.on('changed', (s) => events.emit('auth', s));

  try { ensureWorkspace(WORKSPACE_DIR, COWORK_DIR, log); } catch (err) { log.error(`Không tạo được thư mục làm việc Claude: ${err?.message ?? err}`); }

  const security = {
    reencrypt: null,
    get unlocked() { return db.unlocked; },
    status() {
      return { unlocked: db.unlocked, keyVersion: auth.keyVersion, keyCount: auth.keys.length, reencrypt: this.reencrypt, pending: db.unlocked ? db.countNeedingReencrypt() : null };
    },

    /** Đặt khoá vào db từ phiên đã lưu; đối chiếu máy chủ nếu nối được (thiết bị khác có thể đã đổi chuỗi). */
    async unlock({ syncWithServer = true } = {}) {
      if (!auth.isLoggedIn) return false;
      if (syncWithServer) {
        try {
          const changed = await auth.syncKeys();
          if (changed) log.info(`Máy chủ báo chuỗi mã hoá đã đổi → phiên bản ${auth.keyVersion}; sẽ mã hoá lại dữ liệu.`);
        } catch (err) { log.warn(`Không đối chiếu được chuỗi mã hoá với máy chủ (${err?.message ?? err}) — dùng bản đã lưu trên máy.`); }
      }
      if (!auth.keys.length || !auth.user?.id) { log.error('Phiên đăng nhập không có chuỗi mã hoá.'); return false; }
      cipher.setKeys(auth.user.id, auth.keys, auth.keyVersion);
      db.setCipher(cipher);
      log.info(`Đã mở khoá dữ liệu (khoá phiên bản ${auth.keyVersion}) cho ${auth.user.email}.`);
      events.emit('auth', auth.publicState());
      void manager.restoreAll();
      void this.reencryptIfNeeded();
      automation.schedule();
      suggestions.start();
      setTimeout(() => { void automation.run('sau khi mở khoá'); }, 10000);
      return true;
    },

    /** Khoá lại: dừng Zalo (không còn khoá để ghi tin), gỡ khoá khỏi db. */
    lock() {
      automation.stop();
      suggestions.stop();
      manager.stopAll();
      db.setCipher(null);
      cipher.clear();
      events.emit('auth', auth.publicState());
    },

    async reencryptIfNeeded() {
      try {
        const n = db.countNeedingReencrypt();
        if (!n) return;
        log.info(`Có ${n} dòng cần mã hoá (lại) theo phiên bản ${auth.keyVersion} — chạy nền.`);
        await this.reencryptNow();
      } catch (err) { log.error(`Kiểm tra mã hoá lại thất bại: ${err?.message ?? err}`); }
    },

    async reencryptNow() {
      if (this.reencrypt?.running) return this.reencrypt;
      this.reencrypt = { running: true, startedAt: Date.now(), table: null, done: 0, total: 0, error: null };
      events.emit('security', this.status());
      try {
        const summary = await db.reencryptAll({ onProgress: (p) => { Object.assign(this.reencrypt, p); events.emit('security', this.status()); } });
        this.reencrypt = { running: false, finishedAt: Date.now(), summary, error: null };
        log.info(`Mã hoá lại xong: ${Object.entries(summary).map(([t, s]) => `${t} ${s.done}/${s.total}`).join(', ')}.`);
      } catch (err) {
        this.reencrypt = { running: false, finishedAt: Date.now(), error: err?.message ?? String(err) };
        log.error(`Mã hoá lại thất bại: ${this.reencrypt.error}`);
      }
      events.emit('security', this.status());
      return this.reencrypt;
    },

    /** Đổi chuỗi: máy chủ cấp chuỗi mới → đặt làm khoá hiện tại → mã hoá lại toàn bộ (tin mới đến trong lúc đó đã dùng khoá mới). */
    async rotateKey() {
      if (!db.unlocked) throw new Error('Chưa mở khoá.');
      const r = await auth.rotateKey();
      cipher.setKeys(auth.user.id, auth.keys, auth.keyVersion);
      log.info(`Đã đổi chuỗi mã hoá → phiên bản ${r.version}. Bắt đầu mã hoá lại toàn bộ dữ liệu.`);
      void this.reencryptNow();
      return { version: r.version };
    },
  };

  /**
   * Mục #5: LUÔN có sẵn một gói dữ liệu cho Claude và tự làm mới định kỳ. Gói duy nhất là <workspace>/du-lieu/ (ghi đè),
   * nên số gói trên máy không bao giờ tăng. Chạy một lần ngay sau khi mở khoá (nếu đã có hội thoại) rồi mỗi N phút.
   */
  const automation = {
    timer: null, lastRunAt: null, lastResult: null, nextRunAt: null, running: false,
    status() { const s = loadSettings(); return { minutes: Number(s.autoUpdateMinutes ?? 60), preset: s.defaultPreset ?? 'waiting', lastRunAt: this.lastRunAt, nextRunAt: this.nextRunAt, running: this.running, lastResult: this.lastResult ? { conversations: this.lastResult.conversations, messages: this.lastResult.messages, error: this.lastResult.error ?? null } : null }; },
    schedule() {
      clearInterval(this.timer); this.timer = null; this.nextRunAt = null;
      const mins = Number(loadSettings().autoUpdateMinutes ?? 60);
      if (!db.unlocked || !mins) return;
      this.timer = setInterval(() => { void this.run('auto'); }, mins * 60e3);
      this.nextRunAt = Date.now() + mins * 60e3;
    },
    async run(reason = 'auto') {
      if (!db.unlocked || this.running) return null;
      const s = loadSettings();
      if (!db.stats().conversations) { log.info('Tự cập nhật gói Claude: chưa có hội thoại nào, bỏ qua.'); return null; }
      this.running = true;
      try {
        const r = await updateWorkspaceData({ db, params: presetParams(s.defaultPreset ?? 'waiting', { includeExcel: !!s.includeExcel }, s), root: WORKSPACE_DIR, log, settings: s });
        this.lastResult = r; this.lastRunAt = Date.now();
        log.info(`Tự cập nhật gói Claude (${reason}): ${r.ok ? `${r.conversations} hội thoại, ${r.messages} tin` : r.error}.`);
      } catch (err) {
        this.lastResult = { ok: false, error: err?.message ?? String(err) }; this.lastRunAt = Date.now();
        log.error(`Tự cập nhật gói Claude thất bại: ${this.lastResult.error}`);
      } finally {
        this.running = false;
        const mins = Number(loadSettings().autoUpdateMinutes ?? 60);
        this.nextRunAt = this.timer && mins ? Date.now() + mins * 60e3 : null;
        events.emit('workspace', this.status());
      }
      return this.lastResult;
    },
    stop() { clearInterval(this.timer); this.timer = null; this.nextRunAt = null; },
  };

  /** Gợi ý phản hồi do Claude ghi vào ket-qua/ — theo dõi thư mục, gắn vào hội thoại (cần db đã mở khoá để đọc tên). */
  const suggestions = new SuggestionStore({ root: WORKSPACE_DIR, db, log });
  suggestions.on('changed', (s) => events.emit('suggestions', s));

  const paths = { dataDir: DATA_DIR, workspaceDir: WORKSPACE_DIR, coworkDir: COWORK_DIR, uiDir: UI_DIR };
  const server = buildServer({ db, manager, log, settings, paths, platform, auth, security, events, automation, suggestions });

  await server.listen({ port, host: HOST });
  const url = `http://${HOST}:${port}/`;
  log.info(`Zalo Chat Assistant đang chạy tại ${url} — dữ liệu ở ${DATA_DIR} — thư mục Claude: ${WORKSPACE_DIR}`);

  // Mở khoá SAU khi HTTP đã sẵn sàng để giao diện lên ngay; Zalo chỉ khôi phục khi đã có khoá.
  if (auth.isLoggedIn) void security.unlock();
  else log.info(`Chưa đăng nhập máy chủ (${auth.serverUrl}) — chờ người dùng đăng nhập trên giao diện.`);

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    log.info('Đang dừng…');
    automation.stop();
    suggestions.stop();
    manager.stopAll();
    try { await Promise.race([server.close(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* bỏ qua */ }
    try { db.close(); } catch { /* bỏ qua */ }
  }

  return { url, stop, log, db, manager, auth, security };
}
