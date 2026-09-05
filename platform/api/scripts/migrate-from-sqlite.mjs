#!/usr/bin/env node
/**
 * Nhập dữ liệu từ máy chủ cũ (SQLite của `server/`) sang MongoDB — mục 7 hợp đồng.
 *
 *   node scripts/migrate-from-sqlite.mjs --sqlite ./tmp/auth.db --mongo mongodb://127.0.0.1:27017/zca [--admin a@b.vn]
 *
 * Ba điều đã cân nhắc kỹ, đừng "đơn giản hoá":
 *  1) GIỮ NGUYÊN `users.id` (UUID chuỗi) — ứng dụng desktop dẫn xuất khoá mã hoá từ `user.id`; đổi id là
 *     người dùng mở ứng dụng lên thấy dữ liệu cũ không giải mã được.
 *  2) Chép luôn `refresh_tokens` CÒN HIỆU LỰC với `token_hash` y nguyên (SHA-256 **hex**, đúng như
 *     `server/src/security.js`) — nhờ vậy máy đang đăng nhập tự refresh sang máy chủ mới, không ai phải
 *     đăng nhập lại. Băm sai kiểu (base64url chẳng hạn) thì mọi thiết bị bị đá ra mà không có lỗi nào để lần.
 *  3) Idempotent: chạy lại nhiều lần cho cùng một kết quả (upsert theo id / (userId, version) / tokenHash),
 *     nên chạy thử trước rồi chạy thật lúc cutover đều an toàn.
 *
 * Script CHỈ ĐỌC tệp SQLite. Hãy chạy trên BẢN SAO lấy ra bằng `docker cp`, đừng trỏ vào volume đang chạy.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import Database from 'better-sqlite3';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv);
const sqlitePath = args.sqlite ?? process.env.SQLITE_PATH;
const mongoUrl = args.mongo ?? process.env.MONGO_URL;
const dryRun = !!args['dry-run'];

if (!sqlitePath || !mongoUrl) {
  console.error('Cách dùng: node scripts/migrate-from-sqlite.mjs --sqlite <đường dẫn auth.db> --mongo <MONGO_URL> [--admin email] [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(sqlitePath)) {
  console.error(`Không tìm thấy tệp SQLite: ${path.resolve(sqlitePath)}`);
  process.exit(1);
}

// Email được nâng quyền admin: tham số --admin (nhiều email cách nhau dấu phẩy) + biến ADMIN_EMAILS.
const adminEmails = new Set(
  [String(args.admin ?? ''), String(process.env.ADMIN_EMAILS ?? '')]
    .join(',')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const { User } = await import('../src/models/User.js');
const { ClientKey } = await import('../src/models/ClientKey.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');

// readonly: chắc chắn không ghi một byte nào vào tệp nguồn.
const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });

const users = sqlite.prepare('SELECT * FROM users').all();
const keys = sqlite.prepare('SELECT * FROM client_keys').all();
const now = Date.now();
const tokens = sqlite.prepare('SELECT * FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > ?').all(now);

console.log(`Nguồn SQLite: ${path.resolve(sqlitePath)}`);
console.log(`  users            : ${users.length}`);
console.log(`  client_keys      : ${keys.length}`);
console.log(`  refresh_tokens   : ${tokens.length} (còn hiệu lực)`);

if (dryRun) {
  console.log('\n--dry-run: chỉ đọc, không ghi gì vào MongoDB.');
  sqlite.close();
  process.exit(0);
}

await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 10000 });
console.log(`Đích MongoDB: ${mongoUrl.replace(/\/\/[^@]*@/, '//***@')}`);

let newUsers = 0;
let updatedUsers = 0;
for (const u of users) {
  const email = String(u.email).trim().toLowerCase();
  const existed = await User.findById(u.id).lean();
  const role = adminEmails.has(email) ? 'admin' : (existed?.role ?? 'user');
  await User.updateOne(
    { _id: u.id },
    {
      $set: {
        email,
        name: u.name ?? null,
        passwordHash: u.password_hash,
        role,
        disabled: !!u.disabled,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        lastLoginAt: u.last_login_at ?? null,
      },
    },
    { upsert: true },
  );
  if (existed) updatedUsers += 1; else newUsers += 1;
}

let newKeys = 0;
for (const k of keys) {
  const r = await ClientKey.updateOne(
    { userId: k.user_id, version: k.version },
    { $set: { key: k.key, source: k.source ?? 'server', createdAt: k.created_at } },
    { upsert: true },
  );
  if (r.upsertedCount) newKeys += 1;
}

let newTokens = 0;
for (const t of tokens) {
  const r = await RefreshToken.updateOne(
    { tokenHash: t.token_hash },
    {
      $set: {
        userId: t.user_id,
        device: t.device ?? null,
        createdAt: t.created_at,
        expiresAt: t.expires_at,
        revokedAt: null,
        replacedBy: t.replaced_by ?? null,
      },
    },
    { upsert: true },
  );
  if (r.upsertedCount) newTokens += 1;
}

// Người dùng nào chưa có khoá nào (dữ liệu cũ lỗi) thì cấp ngay một khoá — ứng dụng cần khoá để chạy.
const { ensureKey } = await import('../src/services/keys.js');
let repairedKeys = 0;
for (const u of users) {
  const has = await ClientKey.exists({ userId: u.id });
  if (!has) { await ensureKey(u.id); repairedKeys += 1; }
}

console.log('\nKết quả:');
console.log(`  users            : +${newUsers} mới, ${updatedUsers} cập nhật`);
console.log(`  client_keys      : +${newKeys} mới${repairedKeys ? `, ${repairedKeys} tài khoản được cấp bù khoá` : ''}`);
console.log(`  refresh_tokens   : +${newTokens} mới (thiết bị đang đăng nhập không phải đăng nhập lại)`);
const admins = await User.countDocuments({ role: 'admin' });
console.log(`  quản trị viên    : ${admins}`);
if (!admins) console.log('  ⚠️  Chưa có quản trị viên nào — chạy lại với --admin <email> hoặc đặt ADMIN_EMAILS rồi đăng nhập.');

sqlite.close();
await mongoose.connection.close();
process.exit(0);
