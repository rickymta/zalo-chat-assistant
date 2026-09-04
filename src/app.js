/**
 * Lõi ứng dụng — dùng chung cho hai cách chạy:
 *  - `node src/index.js`  → mở giao diện trong trình duyệt (dành cho người kỹ thuật / máy dev)
 *  - Electron (`electron/main.js`) → cửa sổ ứng dụng macOS, không cần cài Node
 */
import {
  ensureDirs, loadSettings, saveSettings,
  DATA_DIR, SESSIONS_DIR, EXPORTS_DIR, DB_PATH, LOG_PATH, COWORK_DIR, UI_DIR, PORT, HOST,
} from './config.js';
import { createLogger } from './logger.js';
import { openDb } from './db.js';
import { ZaloManager } from './zalo/manager.js';
import { buildServer } from './server.js';

export async function startApp({ platform, port = PORT } = {}) {
  ensureDirs();
  const log = createLogger(LOG_PATH);
  const db = openDb(DB_PATH);
  const settings = { load: loadSettings, save: saveSettings };
  const manager = new ZaloManager({ db, log, sessionsDir: SESSIONS_DIR, getSettings: loadSettings });
  const paths = { dataDir: DATA_DIR, exportsDir: EXPORTS_DIR, coworkDir: COWORK_DIR, uiDir: UI_DIR };
  const server = buildServer({ db, manager, log, settings, paths, platform });

  await server.listen({ port, host: HOST });
  const url = `http://${HOST}:${port}/`;
  log.info(`Zalo Chat Assistant đang chạy tại ${url} — dữ liệu ở ${DATA_DIR}`);

  // Khôi phục phiên SAU khi HTTP đã sẵn sàng để giao diện lên ngay, không chờ Zalo.
  void manager.restoreAll();

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    log.info('Đang dừng…');
    manager.stopAll();
    try { await Promise.race([server.close(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* bỏ qua */ }
    try { db.close(); } catch { /* bỏ qua */ }
  }

  return { url, stop, log, db, manager };
}
