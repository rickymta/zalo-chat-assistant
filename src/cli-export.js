/**
 * Xuất bằng dòng lệnh, không cần giao diện — dùng cho lịch tự động (launchd/cron) hoặc người kỹ thuật.
 *
 *   node src/cli-export.js                       # gói Markdown, 7 ngày gần nhất
 *   node src/cli-export.js --days 1 --waiting    # chỉ hội thoại đang chờ trả lời, hôm qua tới nay
 *   node src/cli-export.js --format markdown,excel --from 2026-09-01 --to 2026-09-04
 *   node src/cli-export.js --all                 # toàn bộ dữ liệu
 *
 * Chạy được song song với ứng dụng đang mở (SQLite WAL cho phép nhiều tiến trình đọc).
 */
import { ensureDirs, loadSettings, DB_PATH, EXPORTS_DIR, COWORK_DIR, LOG_PATH } from './config.js';
import { createLogger } from './logger.js';
import { openDb } from './db.js';
import { runExport } from './export/index.js';

function parseArgs(argv) {
  const out = { format: 'markdown', days: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--format') out.format = next();
    else if (a === '--days') out.days = Number(next());
    else if (a === '--from') out.from = next();
    else if (a === '--to') out.to = next();
    else if (a === '--all') out.all = true;
    else if (a === '--waiting') out.waiting = true;
    else if (a === '--groups') out.groups = true;
    else if (a === '--jsonl') out.jsonl = true;
    else if (a === '--account') out.account = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function vnDayStart(dateStr) {
  // "YYYY-MM-DD" → 00:00 giờ Việt Nam (UTC+7)
  return Date.parse(`${dateStr}T00:00:00+07:00`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Tuỳ chọn: --format markdown|excel|markdown,excel  --days N | --from YYYY-MM-DD --to YYYY-MM-DD | --all  --waiting  --groups  --jsonl  --account <id>');
  process.exit(0);
}

ensureDirs();
const log = createLogger(LOG_PATH);
const db = openDb(DB_PATH);

let from = null;
let to = null;
if (!args.all) {
  if (args.from) from = vnDayStart(args.from);
  if (args.to) to = vnDayStart(args.to) + 86400000;
  if (!args.from && !args.to) from = Date.now() - Number(args.days) * 86400000;
}

const params = {
  formats: String(args.format).split(',').map((s) => s.trim()).filter(Boolean),
  from, to,
  includeGroups: args.groups ?? loadSettings().includeGroups,
  onlyWaiting: !!args.waiting,
  includeJsonl: !!args.jsonl,
  accountIds: args.account ? [args.account] : undefined,
};

const r = await runExport({ db, params, exportsDir: EXPORTS_DIR, coworkDir: COWORK_DIR, log, settings: loadSettings() });
db.close();
if (!r.ok) { console.error(r.error); process.exit(2); }
console.log(`Đã xuất ${r.conversations} hội thoại, ${r.messages} tin → ${r.dir}`);
