#!/usr/bin/env node
/**
 * CHỨNG MINH ứng dụng desktop đang cài chạy được với API mới mà KHÔNG sửa một dòng nào.
 *
 * Script nạp thẳng `src/auth/client.js` của ứng dụng (không sao chép, không giả lập) rồi đi đúng chuỗi
 * ứng dụng thực hiện: register → syncKeys → rotateKey → refresh → logout, cộng thêm đường kiểm tra
 * cập nhật ở mục 6 hợp đồng. Tệp `auth.json` ghi vào thư mục tạm, không đụng dữ liệu thật của người dùng.
 *
 *   node scripts/compat-appclient.mjs [--base http://127.0.0.1:4791]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApi, createRunner, assert, assertEq, rand, parseArgs, apiRoot, testMongoUrl, dropDb } from './lib/harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 4791);

// `src/auth/client.js` của ứng dụng nằm ở gốc kho, tức là hai cấp trên `platform/api`.
const clientPath = path.resolve(apiRoot, '..', '..', 'src', 'auth', 'client.js');
if (!fs.existsSync(clientPath)) {
  console.error(`Không tìm thấy AuthClient của ứng dụng tại ${clientPath}`);
  process.exit(1);
}
const { AuthClient } = await import(pathToFileURL(clientPath).href);
console.log(`Đã nạp AuthClient THẬT của ứng dụng: ${clientPath}`);

let server = null;
let base = args.base;
const mongoUrl = testMongoUrl('zca_compat');
if (!base) {
  server = await startApi({ port, env: { MONGO_URL: mongoUrl } });
  base = server.base;
  console.log(`API con đã lên tại ${base}`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zca-compat-'));
const authFile = path.join(workDir, 'auth.json');

const client = new AuthClient({ authFile, log: console, defaultServerUrl: base });
const t = createRunner('COMPAT (ứng dụng desktop ↔ API mới)');

const email = `app.desktop.${rand()}@meddental.vn`;
const password = 'mat-khau-ung-dung-123';
const S = {};

/** Gọi thẳng API để kiểm chứng phía máy chủ (không qua AuthClient). */
const rawPost = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

t.section('Chuỗi hành động của ứng dụng');

await t.test('ping() — /health đọc được như máy chủ cũ', async () => {
  const health = await client.ping();
  assertEq(health.status, 'ok', 'health.status');
  assert(typeof health.users === 'number', 'health.users');
  assert('smtp' in health, 'health.smtp');
});

await t.test('register() — tạo tài khoản, lưu phiên vào auth.json (quyền 600)', async () => {
  const state = await client.register({ email, password, name: 'Máy Của Tôi' });
  assertEq(state.loggedIn, true, 'loggedIn');
  assertEq(state.mode, 'server', 'mode');
  assertEq(state.user.email, email, 'user.email');
  assertEq(state.keyVersion, 1, 'keyVersion');
  assertEq(state.keyCount, 1, 'keyCount');

  assert(fs.existsSync(authFile), 'không ghi được auth.json');
  const mode = fs.statSync(authFile).mode & 0o777;
  assertEq(mode.toString(8), '600', 'quyền tệp auth.json');

  const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert(saved.accessToken && saved.refreshToken, 'auth.json thiếu token');
  assertEq(saved.keys.length, 1, 'số chuỗi mã hoá đã lưu');
  assert(saved.keys[0].key.length >= 43, 'chuỗi mã hoá phải là 32 byte base64url');
  S.userId = state.user.id;
  S.refresh0 = saved.refreshToken;
});

await t.test('syncKeys() — GET /api/keys, chưa đổi khoá nên phiên bản giữ nguyên', async () => {
  const changed = await client.syncKeys();
  assertEq(changed, false, 'syncKeys báo có đổi khoá');
  assertEq(client.keyVersion, 1, 'keyVersion');
  assertEq(client.keys.length, 1, 'số khoá');
});

await t.test('rotateKey() — máy chủ cấp khoá v2, ứng dụng GIỮ LẠI khoá v1 để giải mã dữ liệu cũ', async () => {
  const res = await client.rotateKey();
  assertEq(res.version, 2, 'phiên bản sau rotate');
  assertEq(client.keyVersion, 2, 'keyVersion trong state');
  assertEq(client.keys.length, 2, 'phải giữ cả khoá cũ lẫn mới');
  assert(client.keys.find((k) => k.version === 1), 'mất khoá v1 ⇒ dữ liệu cũ trên máy không đọc được nữa');
  S.key2 = client.keys.find((k) => k.version === 2).key;
});

await t.test('syncKeys() sau rotate ở thiết bị khác — nhận đủ mọi phiên bản', async () => {
  const changed = await client.syncKeys();
  assertEq(changed, false, 'cùng thiết bị nên phiên bản không đổi');
  assertEq(client.keys.length, 2, 'số khoá sau đồng bộ');
  assertEq(client.keys.find((k) => k.version === 2).key, S.key2, 'khoá v2 phải khớp với khoá máy chủ trả về');
});

await t.test('refresh() — xoay vòng token, token cũ bị máy chủ thu hồi', async () => {
  const before = JSON.parse(fs.readFileSync(authFile, 'utf8')).refreshToken;
  await client.refresh();
  const after = JSON.parse(fs.readFileSync(authFile, 'utf8')).refreshToken;
  assert(after && after !== before, 'refresh token phải đổi sau mỗi lần refresh');

  const reuse = await rawPost('/api/auth/refresh', { refreshToken: before });
  assertEq(reuse.status, 401, 'dùng lại refresh token cũ phải bị từ chối');
  S.refreshLast = after;
});

await t.test('authed() — gọi /api/me bằng access token vừa xoay vòng', async () => {
  const me = await client.authed('/api/me', { method: 'GET' });
  assertEq(me.user.id, S.userId, 'user.id');
  assert(me.keyVersion >= 2, 'keyVersion');
});

await t.test('Kiểm tra cập nhật (mục 6) — /api/releases/check trả đúng hình dạng app đọc', async () => {
  const url = `${base}/api/releases/check?platform=${process.platform}&arch=${process.arch}&version=1.0.0&channel=stable`;
  const data = await (await fetch(url)).json();
  assert('updateAvailable' in data && 'latest' in data && 'mandatory' in data && 'current' in data, `thiếu trường trong phản hồi: ${JSON.stringify(data)}`);
  assertEq(data.current, '1.0.0', 'current');
  assertEq(typeof data.updateAvailable, 'boolean', 'kiểu updateAvailable');
});

await t.test('logout() — thu hồi phiên trên máy chủ và xoá auth.json', async () => {
  await client.logout();
  assertEq(fs.existsSync(authFile), false, 'auth.json phải bị xoá sau khi đăng xuất');
  assertEq(client.isLoggedIn, false, 'isLoggedIn');

  const after = await rawPost('/api/auth/refresh', { refreshToken: S.refreshLast });
  assertEq(after.status, 401, 'refresh token sau logout phải hết hiệu lực');
});

await t.test('login() lại được sau khi đăng xuất, giữ nguyên user.id và mọi khoá cũ', async () => {
  const state = await client.login({ email, password });
  assertEq(state.loggedIn, true, 'loggedIn');
  assertEq(state.user.id, S.userId, 'user.id phải KHÔNG ĐỔI — ứng dụng dẫn xuất khoá mã hoá từ id này');
  assertEq(state.keyVersion, 2, 'keyVersion');
  assertEq(state.keyCount, 2, 'số khoá đồng bộ về');
});

fs.rmSync(workDir, { recursive: true, force: true });
const ok = t.summary();
if (server) { await server.stop(); await dropDb(mongoUrl); }
process.exit(ok ? 0 : 1);
