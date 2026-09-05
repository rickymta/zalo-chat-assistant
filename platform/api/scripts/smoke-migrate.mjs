#!/usr/bin/env node
/**
 * Kiểm thử THẬT script migrate: dựng một SQLite y hệt máy chủ cũ (dùng chính `server/src/db.js` và
 * `server/src/security.js`, không sao chép logic), chạy migrate, rồi chứng minh trên API mới:
 *   - `user.id` giữ nguyên,
 *   - MẬT KHẨU cũ đăng nhập được (định dạng scrypt khớp từng byte),
 *   - REFRESH TOKEN cũ vẫn refresh được ⇒ máy đang đăng nhập KHÔNG bị đá ra sau cutover,
 *   - chuỗi mã hoá giữ đúng phiên bản và nội dung,
 *   - chạy lại lần hai không tạo thêm bản ghi nào (idempotent).
 *
 *   node scripts/smoke-migrate.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { startApi, makeClient, createRunner, assert, assertEq, assertStatus, rand, apiRoot } from './lib/harness.mjs';

const repoRoot = path.resolve(apiRoot, '..', '..');
const { openDb } = await import(pathToFileURL(path.join(repoRoot, 'server', 'src', 'db.js')).href);
const { hashPassword, sha256, randomToken, newClientKey } = await import(pathToFileURL(path.join(repoRoot, 'server', 'src', 'security.js')).href);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zca-migrate-'));
const dbName = `zca_migrate_${rand()}`;
const mongoBase = (process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/zca_dev').replace(/\/[^/]*$/, '');
const mongoUrl = `${mongoBase}/${dbName}`;

// ── Dựng dữ liệu "máy chủ cũ" bằng chính mã nguồn của máy chủ cũ ──────────────
const email = `nguoi.cu.${rand()}@meddental.vn`;
const password = 'mat-khau-he-cu-123';
const userId = crypto.randomUUID();
const legacyRefresh = randomToken(32);

const old = openDb(workDir);
old.raw.prepare('INSERT INTO users (id, email, name, password_hash, created_at, updated_at, last_login_at, disabled) VALUES (?,?,?,?,?,?,?,0)')
  .run(userId, email, 'Người Dùng Hệ Cũ', hashPassword(password), Date.now() - 86400e3, Date.now() - 86400e3, Date.now() - 3600e3);
const key1 = newClientKey();
const key2 = newClientKey();
old.raw.prepare('INSERT INTO client_keys (user_id, version, key, source, created_at) VALUES (?,?,?,?,?)').run(userId, 1, key1, 'server', Date.now() - 86400e3);
old.raw.prepare('INSERT INTO client_keys (user_id, version, key, source, created_at) VALUES (?,?,?,?,?)').run(userId, 2, key2, 'client', Date.now() - 3600e3);
old.insertRefresh(userId, sha256(legacyRefresh), 'MacBook cũ', Date.now() + 20 * 86400e3);
// Một token đã hết hạn — KHÔNG được chép sang.
old.insertRefresh(userId, sha256(randomToken(32)), 'Máy đã bỏ', Date.now() - 1000);
old.close();

const sqlitePath = path.join(workDir, 'auth.db');
console.log(`SQLite giả lập máy chủ cũ: ${sqlitePath}`);

const runMigrate = (extra = []) => spawnSync(
  process.execPath,
  ['scripts/migrate-from-sqlite.mjs', '--sqlite', sqlitePath, '--mongo', mongoUrl, ...extra],
  { cwd: apiRoot, encoding: 'utf8' },
);

const t = createRunner('SMOKE MIGRATE');
t.section('Chuyển dữ liệu từ máy chủ cũ (SQLite) sang MongoDB');

let out1 = '';
await t.test('migrate chạy xong không lỗi, báo đúng số bản ghi', async () => {
  const r = runMigrate(['--admin', email]);
  out1 = `${r.stdout}${r.stderr}`;
  assertEq(r.status, 0, `mã thoát (log: ${out1.slice(-500)})`);
  assert(/users\s+: \+1 mới/.test(out1), `không thấy "+1 users mới" trong log:\n${out1}`);
  assert(/client_keys\s+: \+2 mới/.test(out1), 'phải chép 2 phiên bản khoá');
  assert(/refresh_tokens\s+: \+1 mới/.test(out1), 'chỉ token CÒN HIỆU LỰC mới được chép (1/2)');
});

await t.test('Chỉ token CÒN HIỆU LỰC được chép — token hết hạn bị bỏ lại', async () => {
  // Đo NGAY sau migrate, TRƯỚC khi API chạy: mọi lượt login/refresh về sau đều sinh thêm token,
  // đo muộn là đếm nhầm rồi tưởng migrate sai.
  await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 10000 });
  const n = await mongoose.connection.collection('refresh_tokens').countDocuments({ userId });
  await mongoose.connection.close();
  assertEq(n, 1, 'số refresh token trong Mongo (hệ cũ có 2: 1 còn hạn + 1 đã hết hạn)');
});

const server = await startApi({ env: { MONGO_URL: mongoUrl } });
const api = makeClient(server.base);

await t.test('Mật khẩu cũ đăng nhập được trên API mới (định dạng scrypt khớp)', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assertStatus(r, 200, 'login mật khẩu cũ');
  assertEq(r.body.user.id, userId, 'user.id PHẢI giữ nguyên — app dẫn xuất khoá mã hoá từ id này');
  assertEq(r.body.user.name, 'Người Dùng Hệ Cũ', 'họ tên');
  assertEq(r.body.user.role, 'admin', '--admin phải nâng quyền tài khoản này');
  assertEq(r.body.encryptionKey.version, 2, 'khoá hiện tại là v2');
  assertEq(r.body.encryptionKey.key, key2, 'nội dung khoá v2');
});

await t.test('REFRESH TOKEN cũ vẫn dùng được — máy đang đăng nhập không bị đá ra', async () => {
  const r = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: legacyRefresh } });
  assertStatus(r, 200, 'refresh bằng token của máy chủ cũ');
  assertEq(r.body.user.id, userId, 'user.id');
  assert(r.body.refreshToken !== legacyRefresh, 'token phải được xoay vòng');
  assertEq(r.body.encryptionKey.key, key2, 'khoá trả về sau refresh');
});

await t.test('Giữ đủ mọi phiên bản khoá, đúng nguồn (server/client)', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  const keys = await api('/api/keys', { token: login.body.accessToken });
  assertStatus(keys, 200, '/api/keys');
  assertEq(keys.body.versions.length, 2, 'số phiên bản');
  assertEq(keys.body.versions.find((k) => k.version === 1).key, key1, 'khoá v1');
  assertEq(keys.body.versions.find((k) => k.version === 1).source, 'server', 'nguồn v1');
  assertEq(keys.body.versions.find((k) => k.version === 2).source, 'client', 'nguồn v2');
});

await t.test('Chạy migrate LẦN HAI không tạo thêm bản ghi nào (idempotent)', async () => {
  const r = runMigrate(['--admin', email]);
  const out = `${r.stdout}${r.stderr}`;
  assertEq(r.status, 0, 'mã thoát lần hai');
  assert(/users\s+: \+0 mới, 1 cập nhật/.test(out), `lần hai phải là 0 user mới:\n${out}`);
  assert(/client_keys\s+: \+0 mới/.test(out), 'lần hai không được thêm khoá');
  assert(/refresh_tokens\s+: \+0 mới/.test(out), 'lần hai không được thêm token');
});

await t.test('--dry-run chỉ đọc, không ghi', async () => {
  const r = runMigrate(['--dry-run']);
  assertEq(r.status, 0, 'mã thoát dry-run');
  assert(/không ghi gì vào MongoDB/.test(r.stdout), 'thiếu ghi chú dry-run');
});

const ok = t.summary();
await server.stop();
// Dọn database tạm
await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 10000 });
await mongoose.connection.dropDatabase();
await mongoose.connection.close();
fs.rmSync(workDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
