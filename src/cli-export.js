/**
 * Cập nhật thư mục làm việc Claude bằng dòng lệnh (không cần giao diện) — dùng cho lịch tự động hoặc người kỹ thuật.
 * Cần data/auth.json (đã đăng nhập trong ứng dụng) để có khoá giải mã.
 *
 *   node src/cli-export.js                      # kiểu mặc định: khách đang chờ trả lời
 *   node src/cli-export.js --preset week --excel
 *   node src/cli-export.js --preset custom --from 2026-09-01 --to 2026-09-04 --groups
 */
import { ensureDirs, loadSettings, DB_PATH, LOG_PATH, WORKSPACE_DIR, COWORK_DIR, AUTH_FILE, DEFAULT_SERVER_URL } from './config.js';
import { createLogger } from './logger.js';
import { openDb } from './db.js';
import { AuthClient } from './auth/client.js';
import { Cipher } from './crypto/cipher.js';
import { ensureWorkspace, updateWorkspaceData } from './workspace.js';
import { presetParams } from './server.js';

function parseArgs(argv) {
  const out = { preset: 'waiting' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === '--preset') out.preset = next();
    else if (a === '--from') out.from = next();
    else if (a === '--to') out.to = next();
    else if (a === '--excel') out.includeExcel = true;
    else if (a === '--groups') out.includeGroups = true;
    else if (a === '--full') out.fullHistory = true;
    else if (a === '--jsonl') out.includeJsonl = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log('Tuỳ chọn: --preset waiting|today|week|groups|all|custom  --from YYYY-MM-DD --to YYYY-MM-DD  --excel  --groups  --full  --jsonl'); process.exit(0); }

ensureDirs();
const log = createLogger(LOG_PATH);
const db = openDb(DB_PATH);
const auth = new AuthClient({ authFile: AUTH_FILE, log, defaultServerUrl: DEFAULT_SERVER_URL });
if (!auth.keys.length || !auth.user?.id) { console.error('Chưa có phiên đăng nhập (data/auth.json). Hãy đăng nhập trong ứng dụng trước.'); process.exit(2); }
const cipher = new Cipher();
cipher.setKeys(auth.user.id, auth.keys, auth.keyVersion);
db.setCipher(cipher);
ensureWorkspace(WORKSPACE_DIR, COWORK_DIR, log);

const settings = loadSettings();
const params = presetParams(args.preset, args, settings);
const r = await updateWorkspaceData({ db, params, root: WORKSPACE_DIR, log, settings });
db.close();
if (!r.ok) { console.error(r.error); process.exit(2); }
console.log(`Đã cập nhật ${r.conversations} hội thoại, ${r.messages} tin → ${r.dir}`);
