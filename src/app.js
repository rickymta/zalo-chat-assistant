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
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ensureDirs, loadSettings, saveSettings,
  ROOT_DIR, DATA_DIR, SESSIONS_DIR, SENT_DIR, DB_PATH, LOG_PATH, COWORK_DIR, WORKSPACE_DIR, UI_DIR, AUTH_FILE, DEFAULT_SERVER_URL, PORT, HOST,
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
import { createUpdater } from './updates.js';

export async function startApp({ platform, port = PORT } = {}) {
  ensureDirs();
  const log = createLogger(LOG_PATH);
  const db = openDb(DB_PATH);
  const settings = { load: loadSettings, save: saveSettings };
  const manager = new ZaloManager({ db, log, sessionsDir: SESSIONS_DIR, sentDir: SENT_DIR, getSettings: loadSettings });
  const auth = new AuthClient({ authFile: AUTH_FILE, log, defaultServerUrl: DEFAULT_SERVER_URL });
  const cipher = new Cipher();
  cipher.onWarn = (m) => log.warn(`Mã hoá: ${m}`);
  const events = new EventEmitter();
  auth.on('changed', (s) => events.emit('auth', s));

  try { ensureWorkspace(WORKSPACE_DIR, COWORK_DIR, log); } catch (err) { log.error(`Không tạo được thư mục làm việc Claude: ${err?.message ?? err}`); }

  const security = {
    reencrypt: null,
    ownerFile: path.join(DATA_DIR, 'owner.json'),
    readOwner() { try { return JSON.parse(fs.readFileSync(this.ownerFile, 'utf8')); } catch { return null; } },
    /** Ghi danh tính đang mở khoá DB — để lần đăng nhập bằng danh tính KHÁC biết dữ liệu hiện có không đọc được. */
    markOwner() { if (!auth.user?.id) return; try { fs.writeFileSync(this.ownerFile, JSON.stringify({ userId: auth.user.id, email: auth.user.email ?? null, mode: auth.mode, at: Date.now() }, null, 2)); } catch { /* bỏ qua */ } },
    ownerConflict(newUserId) {
      const o = this.readOwner(); if (!o?.userId || o.userId === newUserId) return null;
      const st = db.stats(); if (!st.messages && !st.conversations) return null;
      return { needsReset: true, previous: { email: o.email ?? null, mode: o.mode ?? 'server' }, messages: st.messages, conversations: st.conversations };
    },
    resetData() { manager.stopAll(); db.resetAll(); try { fs.unlinkSync(this.ownerFile); } catch { /* không có */ } log.warn('Đã xoá toàn bộ dữ liệu hội thoại trên máy (đổi danh tính / thoát dùng thử).'); },
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
      this.markOwner();
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
    timer: null, lastRunAt: null, lastResult: null, nextRunAt: null, running: false, quietTimer: null, quietAt: null, lastActivityAt: null,
    status() { const s = loadSettings(); return { minutes: Number(s.autoUpdateMinutes ?? 30), quietMinutes: Number(s.quietMinutes ?? 3), preset: s.defaultPreset ?? 'today', lastRunAt: this.lastRunAt, nextRunAt: this.nextRunAt, quietAt: this.quietAt, lastActivityAt: this.lastActivityAt, running: this.running, lastResult: this.lastResult ? { conversations: this.lastResult.conversations, messages: this.lastResult.messages, error: this.lastResult.error ?? null } : null }; },
    /** Có tin mới (đến hoặc đi): hẹn cập nhật gói sau N phút yên lặng — mỗi tin mới lại dời mốc. */
    onActivity() {
      this.lastActivityAt = Date.now();
      const mins = Number(loadSettings().quietMinutes ?? 3);
      if (!db.unlocked || !mins) return;
      clearTimeout(this.quietTimer);
      this.quietAt = Date.now() + mins * 60e3;
      this.quietTimer = setTimeout(() => { this.quietTimer = null; this.quietAt = null; void this.run(`${mins} phút sau tin cuối`); }, mins * 60e3);
      events.emit('workspace', this.status());
    },
    /**
     * Chạy theo MỐC GIỜ TRÒN (60 phút ⇒ đúng :00, 30 phút ⇒ :00/:30…) thay vì đếm từ lúc mở khoá — để lịch tự động của
     * Claude Cowork (chạy mỗi 5 phút) luôn đọc được gói vừa cập nhật ở mốc tròn (30 phút ⇒ :00/:30).
     */
    schedule() {
      clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; this.nextRunAt = null;
      const mins = Number(loadSettings().autoUpdateMinutes ?? 30);
      if (!db.unlocked || !mins) return;
      const period = mins * 60e3;
      const next = Math.ceil((Date.now() + 1000) / period) * period;
      this.nextRunAt = next;
      this.timer = setTimeout(() => {
        void this.run('auto');
        this.timer = setInterval(() => { void this.run('auto'); }, period);
      }, Math.max(1000, next - Date.now()));
    },
    async run(reason = 'auto') {
      if (!db.unlocked || this.running) return null;
      const s = loadSettings();
      if (!db.stats().conversations) { log.info('Tự cập nhật gói Claude: chưa có hội thoại nào, bỏ qua.'); return null; }
      this.running = true;
      try {
        const r = await updateWorkspaceData({ db, params: presetParams(s.defaultPreset ?? 'waiting', { includeExcel: !!s.includeExcel }, s), root: WORKSPACE_DIR, log, settings: s, gaps: power.recentGaps(48) });
        this.lastResult = r; this.lastRunAt = Date.now();
        log.info(`Tự cập nhật gói Claude (${reason}): ${r.ok ? `${r.conversations} hội thoại, ${r.messages} tin` : r.error}.`);
      } catch (err) {
        this.lastResult = { ok: false, error: err?.message ?? String(err) }; this.lastRunAt = Date.now();
        log.error(`Tự cập nhật gói Claude thất bại: ${this.lastResult.error}`);
      } finally {
        this.running = false;
        const mins = Number(loadSettings().autoUpdateMinutes ?? 30);
        this.nextRunAt = this.timer && mins ? Math.ceil((Date.now() + 1000) / (mins * 60e3)) * (mins * 60e3) : null;
        events.emit('workspace', this.status());
      }
      return this.lastResult;
    },
    stop() { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; this.nextRunAt = null; clearTimeout(this.quietTimer); this.quietTimer = null; this.quietAt = null; },
  };

  /** Gợi ý phản hồi do Claude ghi vào ket-qua/ — theo dõi thư mục, gắn vào hội thoại (cần db đã mở khoá để đọc tên). */
  manager.on('message', () => automation.onActivity());

  const suggestions = new SuggestionStore({ root: WORKSPACE_DIR, db, log });
  suggestions.on('changed', (s) => events.emit('suggestions', s));

  /**
   * Máy ngủ / thức. Lúc máy ngủ Zalo mất kết nối; tin đến trong lúc đó chỉ lấy lại được nếu Zalo gửi bù khi nối lại.
   * Ghi lại từng khoảng trống để (1) giao diện báo người dùng, (2) gói du-lieu/ mang theo cho Claude biết tin có thể thiếu.
   * Chống ngủ: Electron dùng powerSaveBlocker (qua platform.setKeepAwake), chạy Node trên macOS dùng caffeinate — màn
   * hình vẫn tắt/khoá được, chỉ hệ thống không tự ngủ. Gập MacBook vẫn ngủ theo hệ điều hành.
   */
  const POWER_FILE = path.join(DATA_DIR, 'power.json');
  const power = {
    sleepingSince: null, gaps: [], caffeinate: null,
    load() { try { const j = JSON.parse(fs.readFileSync(POWER_FILE, 'utf8')); this.gaps = Array.isArray(j.gaps) ? j.gaps.slice(-50) : []; } catch { this.gaps = []; } },
    save() { try { fs.writeFileSync(POWER_FILE, JSON.stringify({ gaps: this.gaps.slice(-50) }, null, 2)); } catch { /* bỏ qua */ } },
    recentGaps(hours = 48) { const since = Date.now() - hours * 3600e3; return this.gaps.filter((g) => g.to >= since); },
    supported() { return typeof platform?.setKeepAwake === 'function' || process.platform === 'darwin'; },
    active() { if (typeof platform?.getKeepAwake === 'function') return !!platform.getKeepAwake(); return !!this.caffeinate; },
    status() { return { supported: this.supported(), keepAwake: !!loadSettings().keepAwake, active: this.active(), sleepingSince: this.sleepingSince, lastGap: this.gaps.at(-1) ?? null, gaps24h: this.recentGaps(24).length }; },
    applyKeepAwake() {
      const want = !!loadSettings().keepAwake;
      if (typeof platform?.setKeepAwake === 'function') {
        try { platform.setKeepAwake(want); log.info(want ? 'Đã bật chống ngủ máy (màn hình vẫn tắt được).' : 'Đã tắt chống ngủ máy.'); } catch (err) { log.warn(`Không đặt được chế độ chống ngủ: ${err?.message ?? err}`); }
        return;
      }
      if (process.platform !== 'darwin') return;
      if (want && !this.caffeinate) {
        try { this.caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }); this.caffeinate.on('exit', () => { this.caffeinate = null; }); this.caffeinate.on('error', (err) => { log.warn(`caffeinate lỗi: ${err?.message ?? err}`); this.caffeinate = null; }); log.info('Đã bật chống ngủ máy (caffeinate).'); }
        catch (err) { log.warn(`Không chạy được caffeinate: ${err?.message ?? err}`); }
      }
      if (!want && this.caffeinate) { try { this.caffeinate.kill(); } catch { /* bỏ qua */ } this.caffeinate = null; log.info('Đã tắt chống ngủ máy.'); }
    },
    onSuspend(kind = 'sleep') {
      if (this.sleepingSince) return;
      this.sleepingSince = Date.now();
      log.warn('Máy bắt đầu ngủ — Zalo sẽ mất kết nối cho tới khi máy thức.');
      events.emit('power', this.status());
    },
    onResume(kind = 'sleep') {
      const from = this.sleepingSince; this.sleepingSince = null;
      if (from) {
        const gap = { from, to: Date.now(), kind };
        this.gaps.push(gap); this.gaps = this.gaps.slice(-50); this.save();
        log.warn(`Máy thức sau ${Math.round((gap.to - from) / 60e3)} phút ngủ — nối lại Zalo và xin tin bỏ lỡ.`);
      } else log.info('Máy thức — kiểm tra lại kết nối Zalo.');
      events.emit('power', this.status());
      if (!db.unlocked) return;
      setTimeout(() => { void manager.resyncAll(); }, 4000);
      // Cập nhật gói cho Claude sau khi tin bù đã về — khoảng trống được ghi vào du-lieu/.trang-thai.json + README.
      setTimeout(() => { void automation.run('sau khi máy thức'); }, 90000);
    },
    stop() { if (this.caffeinate) { try { this.caffeinate.kill(); } catch { /* bỏ qua */ } this.caffeinate = null; } },
  };
  power.load();

  const paths = { dataDir: DATA_DIR, workspaceDir: WORKSPACE_DIR, coworkDir: COWORK_DIR, uiDir: UI_DIR, sentDir: SENT_DIR };
  // Phiên bản: Electron lấy từ Info.plist (app.getVersion()); chạy Node thì đọc package.json.
  const appVersion = platform?.appVersion || readPackageVersion();
  const updater = createUpdater({ auth, settings, platform, log, events, version: appVersion });
  const server = buildServer({ db, manager, log, settings, paths, platform, auth, security, events, automation, suggestions, power, updater });

  await server.listen({ port, host: HOST });
  const url = `http://${HOST}:${port}/`;
  log.info(`Zalo Chat Assistant đang chạy tại ${url} — dữ liệu ở ${DATA_DIR} — thư mục Claude: ${WORKSPACE_DIR}`);

  power.applyKeepAwake();
  // Kiểm tra bản cập nhật không cần đăng nhập/mở khoá: 20 giây sau khi khởi động rồi mỗi 6 giờ.
  updater.schedule();

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
    power.stop();
    updater.stop();
    manager.stopAll();
    try { await Promise.race([server.close(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* bỏ qua */ }
    try { db.close(); } catch { /* bỏ qua */ }
  }

  return { url, stop, log, db, manager, auth, security, power, updater };
}

/** Phiên bản khi chạy bằng Node (không có app.getVersion() của Electron). */
function readPackageVersion() {
  try { return String(JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '0.0.0'); }
  catch { return '0.0.0'; }
}
