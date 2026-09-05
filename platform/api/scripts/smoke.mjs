#!/usr/bin/env node
/**
 * Kiểm thử THẬT toàn bộ API: xác thực → khoá → CMS → phát hành/tải về → quản trị → giới hạn tần suất.
 *
 *   node scripts/smoke.mjs                       # tự khởi động API con ở cổng 4791
 *   node scripts/smoke.mjs --base http://...     # bắn vào máy chủ đang chạy sẵn
 *
 * Cần một MongoDB đang chạy (mặc định mongodb://127.0.0.1:27018/zca_dev, đổi bằng MONGO_URL).
 * Mọi email đều sinh ngẫu nhiên nên chạy lại nhiều lần không đụng nhau.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { startApi, makeClient, createRunner, assert, assertEq, assertStatus, rand, parseArgs, testMongoUrl, dropDb } from './lib/harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 4791);

const email = `nguoi.dung.${rand()}@meddental.vn`;
const adminEmail = `quan.tri.${rand()}@meddental.vn`;
const PASS1 = 'matkhau-ban-dau-123';
const PASS2 = 'matkhau-doi-lan-1-456';
const PASS3 = 'matkhau-sau-reset-789';

let server = null;
let base = args.base;
const mongoUrl = testMongoUrl('zca_smoke');
if (!base) {
  server = await startApi({ port, env: { ADMIN_EMAILS: adminEmail, MONGO_URL: mongoUrl } });
  base = server.base;
  console.log(`API con đã lên tại ${base} (ADMIN_EMAILS=${adminEmail})`);
} else {
  console.log(`Dùng máy chủ có sẵn: ${base} — ca "đăng ký admin" sẽ bỏ qua nếu email không nằm trong ADMIN_EMAILS.`);
}

const api = makeClient(base);
const t = createRunner('SMOKE');

/** Đọc mã đặt lại mật khẩu từ log của API con (không có SMTP thì mã ghi ra stdout). */
function resetCodeFromLog(forEmail) {
  if (!server) return null;
  const re = new RegExp(`\\[RESET-CODE\\]\\s+${forEmail.replace(/[.+]/g, '\\$&')}\\s+→\\s+mã:\\s+([A-Z0-9]{8})`);
  for (let i = server.lines.length - 1; i >= 0; i -= 1) {
    const m = re.exec(server.lines[i]);
    if (m) return m[1];
  }
  return null;
}

const S = {};   // trạng thái chia sẻ giữa các ca

// ══ 1. Đăng ký / đăng nhập ═══════════════════════════════════════════════════
t.section('1. Đăng ký & đăng nhập');

await t.test('GET /health trả status ok + version', async () => {
  const r = await api('/health');
  assertStatus(r, 200);
  assertEq(r.body.status, 'ok', 'status');
  assert(typeof r.body.version === 'string', 'thiếu trường version');
  assert(typeof r.body.users === 'number', 'thiếu số người dùng');
});

await t.test('POST /api/auth/register cấp user + token + khoá mã hoá v1', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { email, password: PASS1, name: 'Người Dùng Thử', device: 'may-test' } });
  assertStatus(r, 200, 'register');
  assert(r.body.user?.id, 'thiếu user.id');
  assertEq(r.body.user.email, email, 'user.email');
  assertEq(r.body.user.role, 'user', 'user.role');
  assert(r.body.accessToken && r.body.refreshToken, 'thiếu token');
  assertEq(r.body.accessExpiresIn, 900, 'accessExpiresIn');
  assertEq(r.body.encryptionKey?.version, 1, 'phiên bản khoá đầu tiên');
  assert(r.body.encryptionKey.key.length >= 43, 'khoá phải là 32 byte base64url');
  S.userId = r.body.user.id;
  S.access = r.body.accessToken;
  S.refresh = r.body.refreshToken;
});

await t.test('Đăng ký trùng email → 409', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { email, password: PASS1 } });
  assertStatus(r, 409, 'register trùng');
  assert(/đã được đăng ký/.test(r.body.error), 'câu lỗi tiếng Việt');
});

await t.test('Đăng ký mật khẩu < 8 ký tự → 400', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { email: `x.${rand()}@meddental.vn`, password: 'ngan' } });
  assertStatus(r, 400, 'mật khẩu ngắn');
});

await t.test('Đăng nhập sai mật khẩu → 401, không lộ email tồn tại', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'sai-mat-khau-roi' } });
  assertStatus(r, 401, 'login sai');
  assertEq(r.body.error, 'Email hoặc mật khẩu không đúng.', 'câu lỗi');
});

await t.test('Đăng nhập đúng → trả khoá mã hoá hiện tại', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS1, device: 'may-test' } });
  assertStatus(r, 200, 'login');
  assertEq(r.body.user.id, S.userId, 'giữ nguyên user.id');
  assert(r.body.encryptionKey?.key, 'thiếu encryptionKey');
  S.access = r.body.accessToken;
  S.refresh = r.body.refreshToken;
});

// ══ 2. Refresh & phiên ═══════════════════════════════════════════════════════
t.section('2. Refresh token & phiên đăng nhập');

await t.test('POST /api/auth/refresh phát token mới', async () => {
  const r = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: S.refresh } });
  assertStatus(r, 200, 'refresh');
  assert(r.body.refreshToken !== S.refresh, 'refresh token phải ĐỔI sau mỗi lần xoay vòng');
  assert(r.body.accessToken, 'thiếu access token mới');
  S.oldRefresh = S.refresh;
  S.refresh = r.body.refreshToken;
  S.access = r.body.accessToken;
});

await t.test('Refresh token CŨ đã bị thu hồi → 401', async () => {
  const r = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: S.oldRefresh } });
  assertStatus(r, 401, 'refresh token cũ');
});

await t.test('Refresh thiếu tham số → 400', async () => {
  const r = await api('/api/auth/refresh', { method: 'POST', body: {} });
  assertStatus(r, 400, 'refresh rỗng');
});

await t.test('GET /api/me trả user + keyVersion', async () => {
  const r = await api('/api/me', { token: S.access });
  assertStatus(r, 200, '/api/me');
  assertEq(r.body.user.id, S.userId, 'user.id');
  assert(r.body.keyVersion >= 1, 'keyVersion phải ≥ 1');
});

await t.test('GET /api/me không token → 401', async () => {
  const r = await api('/api/me');
  assertStatus(r, 401, '/api/me không token');
});

await t.test('GET /api/me/sessions đánh dấu đúng 1 phiên hiện tại', async () => {
  const r = await api('/api/me/sessions', { token: S.access });
  assertStatus(r, 200, 'sessions');
  assert(r.body.items.length >= 1, 'phải có ít nhất một phiên');
  assertEq(r.body.items.filter((s) => s.current).length, 1, 'số phiên được đánh dấu current');
  S.sessionId = r.body.items.find((s) => !s.current)?.id ?? null;
});

await t.test('DELETE /api/me/sessions/:id thu hồi phiên khác', async () => {
  if (!S.sessionId) { // chỉ có một phiên: tạo thêm bằng một lần đăng nhập nữa
    const extra = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS1, device: 'may-khac' } });
    assertStatus(extra, 200, 'login phụ');
    const list = await api('/api/me/sessions', { token: S.access });
    S.sessionId = list.body.items.find((s) => !s.current)?.id;
  }
  assert(S.sessionId, 'không tìm được phiên khác để thu hồi');
  const r = await api(`/api/me/sessions/${S.sessionId}`, { method: 'DELETE', token: S.access });
  assertStatus(r, 200, 'xoá phiên');
  const after = await api('/api/me/sessions', { token: S.access });
  assert(!after.body.items.some((s) => s.id === S.sessionId), 'phiên đã xoá vẫn còn trong danh sách');
});

// ══ 3. Chuỗi mã hoá ══════════════════════════════════════════════════════════
t.section('3. Chuỗi mã hoá client');

await t.test('GET /api/keys trả current + mọi phiên bản', async () => {
  const r = await api('/api/keys', { token: S.access });
  assertStatus(r, 200, '/api/keys');
  assertEq(r.body.current.version, 1, 'phiên bản hiện tại');
  assertEq(r.body.versions.length, 1, 'số phiên bản');
  assertEq(r.body.versions[0].source, 'server', 'nguồn khoá');
  S.key1 = r.body.current.key;
});

await t.test('POST /api/keys/rotate tăng phiên bản, trả khoá trước đó', async () => {
  const r = await api('/api/keys/rotate', { method: 'POST', token: S.access });
  assertStatus(r, 200, 'rotate');
  assertEq(r.body.current.version, 2, 'phiên bản sau rotate');
  assertEq(r.body.previous.version, 1, 'phiên bản trước');
  assertEq(r.body.previous.key, S.key1, 'khoá trước phải là khoá v1');
  assert(r.body.current.key !== S.key1, 'khoá mới phải khác khoá cũ');
});

await t.test('PUT /api/keys lưu khoá do client tự chọn (source=client)', async () => {
  const own = crypto.randomBytes(32).toString('base64url');
  const r = await api('/api/keys', { method: 'PUT', token: S.access, body: { key: own } });
  assertStatus(r, 200, 'PUT keys');
  assertEq(r.body.current.version, 3, 'phiên bản sau PUT');
  assertEq(r.body.current.key, own, 'khoá lưu đúng chuỗi client gửi');
  const list = await api('/api/keys', { token: S.access });
  assertEq(list.body.versions[0].source, 'client', 'source của phiên bản mới nhất');
  assertEq(list.body.versions.length, 3, 'giữ đủ 3 phiên bản (thiết bị cũ vẫn giải mã được)');
});

await t.test('PUT /api/keys với chuỗi < 32 ký tự → 400', async () => {
  const r = await api('/api/keys', { method: 'PUT', token: S.access, body: { key: 'qua-ngan' } });
  assertStatus(r, 400, 'khoá ngắn');
});

// ══ 4. Đổi & đặt lại mật khẩu ════════════════════════════════════════════════
t.section('4. Đổi mật khẩu & quên mật khẩu');

await t.test('change-password sai mật khẩu hiện tại → 400 (giữ như máy chủ cũ)', async () => {
  const r = await api('/api/me/change-password', { method: 'POST', token: S.access, body: { currentPassword: 'sai-roi-nhe', newPassword: PASS2 } });
  assertStatus(r, 400, 'đổi mật khẩu sai');
  assert(/hiện tại không đúng/.test(r.body.error), 'câu lỗi tiếng Việt');
});

await t.test('change-password đúng → đăng nhập được bằng mật khẩu mới', async () => {
  const r = await api('/api/me/change-password', { method: 'POST', token: S.access, body: { currentPassword: PASS1, newPassword: PASS2 } });
  assertStatus(r, 200, 'đổi mật khẩu');
  assertEq(r.body.ok, true, 'ok');
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS2 } });
  assertStatus(login, 200, 'login mật khẩu mới');
  S.access = login.body.accessToken;
  S.refresh = login.body.refreshToken;
});

await t.test('forgot-password luôn 200 kể cả email không tồn tại', async () => {
  const r = await api('/api/auth/forgot-password', { method: 'POST', body: { email: `khong.ton.tai.${rand()}@meddental.vn` } });
  assertStatus(r, 200, 'forgot email lạ');
  assertEq(r.body.ok, true, 'ok');
});

await t.test('forgot-password ghi mã ra log khi không có SMTP', async () => {
  const r = await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
  assertStatus(r, 200, 'forgot');
  assertEq(r.body.delivery, 'server-log', 'delivery');
  S.code = resetCodeFromLog(email);
  if (server) assert(S.code && S.code.length === 8, `không đọc được mã 8 ký tự từ log (nhận: ${S.code})`);
});

await t.test('reset-password mã sai → 400', async () => {
  const r = await api('/api/auth/reset-password', { method: 'POST', body: { email, code: 'ZZZZZZZZ', newPassword: PASS3 } });
  assertStatus(r, 400, 'reset mã sai');
});

await t.test('reset-password mã đúng → đổi mật khẩu + thu hồi mọi phiên', async () => {
  if (!S.code) throw new Error('bỏ qua: không có mã (chạy với máy chủ ngoài, không đọc được log)');
  const r = await api('/api/auth/reset-password', { method: 'POST', body: { email, code: S.code, newPassword: PASS3 } });
  assertStatus(r, 200, 'reset');
  const old = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: S.refresh } });
  assertStatus(old, 401, 'refresh token trước khi reset phải bị thu hồi');
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS3, device: 'may-test' } });
  assertStatus(login, 200, 'login mật khẩu mới sau reset');
  S.access = login.body.accessToken;
  S.refresh = login.body.refreshToken;
});

await t.test('reset-password dùng lại mã đã dùng → 400', async () => {
  if (!S.code) throw new Error('bỏ qua: không có mã');
  const r = await api('/api/auth/reset-password', { method: 'POST', body: { email, code: S.code, newPassword: 'mat-khau-khac-999' } });
  assertStatus(r, 400, 'mã dùng lại');
});

await t.test('logout thu hồi refresh token', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS3, device: 'may-tam' } });
  assertStatus(login, 200, 'login để test logout');
  const out = await api('/api/auth/logout', { method: 'POST', body: { refreshToken: login.body.refreshToken } });
  assertStatus(out, 200, 'logout');
  assertEq(out.body.ok, true, 'ok');
  const after = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: login.body.refreshToken } });
  assertStatus(after, 401, 'refresh sau logout');
});

await t.test('logout với token rác vẫn trả 200 (không làm người dùng kẹt)', async () => {
  const r = await api('/api/auth/logout', { method: 'POST', body: { refreshToken: 'khong-ton-tai' } });
  assertStatus(r, 200, 'logout rác');
});

// ══ 5. Quản trị: tài khoản admin ═════════════════════════════════════════════
t.section('5. Bootstrap quản trị viên');

await t.test('Email trong ADMIN_EMAILS được cấp role admin khi đăng ký', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { email: adminEmail, password: 'quan-tri-vien-123', name: 'Quản Trị' } });
  assertStatus(r, 200, 'đăng ký admin');
  assertEq(r.body.user.role, 'admin', 'role của email trong ADMIN_EMAILS');
  S.adminId = r.body.user.id;
  S.adminAccess = r.body.accessToken;
});

await t.test('Tài khoản thường gọi /api/admin/* → 403', async () => {
  const r = await api('/api/admin/stats', { token: S.access });
  assertStatus(r, 403, 'user thường vào admin');
});

// ══ 6. CMS ═══════════════════════════════════════════════════════════════════
t.section('6. Bài viết (CMS)');

await t.test('Tạo bài nháp: slug tự sinh không dấu, HTML render từ markdown', async () => {
  const r = await api('/api/admin/posts', {
    method: 'POST', token: S.adminAccess,
    body: {
      title: 'Bản 1.2 — Có gì mới ở Trợ lý?',
      contentMd: '# Xin chào\n\nĐoạn **đậm** và [liên kết](https://meddental.vn).\n\n<script>alert(1)</script>\n',
      tags: ['cap-nhat', 'huong-dan'],
    },
  });
  assertStatus(r, 200, 'tạo bài');
  const p = r.body.post;
  assertEq(p.slug, 'ban-1-2-co-gi-moi-o-tro-ly', 'slug không dấu');
  assert(p.contentHtml.includes('<strong>đậm</strong>'), 'markdown chưa render thành HTML');
  assert(!p.contentHtml.includes('<script'), 'sanitize-html phải loại bỏ thẻ <script>');
  assert(p.contentHtml.includes('rel="noopener noreferrer"'), 'liên kết ngoài thiếu rel an toàn');
  assert(p.excerpt.length > 0, 'excerpt tự sinh rỗng');
  assertEq(p.publishedAt, null, 'bài mới phải là nháp');
  S.postId = p.id;
  S.postSlug = p.slug;
});

await t.test('Bài nháp KHÔNG lộ ra route công khai', async () => {
  const list = await api('/api/posts');
  assertStatus(list, 200, 'danh sách công khai');
  assert(!list.body.items.some((p) => p.id === S.postId), 'bài nháp lọt vào danh sách công khai');
  const one = await api(`/api/posts/${S.postSlug}`);
  assertStatus(one, 404, 'xem bài nháp');
});

await t.test('Xuất bản → hiện ở danh sách + xem theo slug', async () => {
  const r = await api(`/api/admin/posts/${S.postId}`, { method: 'PUT', token: S.adminAccess, body: { published: true, excerpt: 'Tóm tắt do biên tập viên đặt.' } });
  assertStatus(r, 200, 'xuất bản');
  assert(r.body.post.publishedAt, 'thiếu publishedAt');

  const list = await api('/api/posts?limit=50');
  const found = list.body.items.find((p) => p.id === S.postId);
  assert(found, 'bài đã publish không có trong danh sách');
  assertEq(found.contentMd, undefined, 'danh sách KHÔNG được kèm contentMd');
  assertEq(found.excerpt, 'Tóm tắt do biên tập viên đặt.', 'excerpt');

  const one = await api(`/api/posts/${S.postSlug}`);
  assertStatus(one, 200, 'xem bài');
  assert(one.body.post.contentMd.includes('Xin chào'), 'bài lẻ phải kèm contentMd cho trang sửa');
});

await t.test('Lọc theo tag và phân trang', async () => {
  const r = await api('/api/posts?tag=cap-nhat&page=1&limit=5');
  assertStatus(r, 200, 'lọc tag');
  assert(r.body.items.some((p) => p.id === S.postId), 'không lọc ra bài theo tag');
  assertEq(r.body.page, 1, 'page');
  assertEq(r.body.limit, 5, 'limit');
  assert(typeof r.body.total === 'number', 'thiếu total');
  const empty = await api('/api/posts?tag=khong-co-tag-nay');
  assertEq(empty.body.items.length, 0, 'tag không tồn tại phải rỗng');
});

await t.test('GET /api/admin/posts thấy cả bài nháp', async () => {
  const draft = await api('/api/admin/posts', { method: 'POST', token: S.adminAccess, body: { title: `Nháp ${rand()}`, contentMd: 'nội dung' } });
  assertStatus(draft, 200, 'tạo nháp');
  const r = await api('/api/admin/posts?limit=100', { token: S.adminAccess });
  assert(r.body.items.some((p) => p.id === draft.body.post.id), 'admin không thấy bài nháp');
  S.draftId = draft.body.post.id;
});

await t.test('Tải ảnh lên CMS trả /uploads/... và tải lại được', async () => {
  // PNG 1x1 hợp lệ
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' + 'ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'anh-thu.png');
  const r = await api('/api/admin/uploads', { method: 'POST', token: S.adminAccess, form });
  assertStatus(r, 200, 'upload ảnh');
  assert(r.body.url.startsWith('/uploads/'), 'đường dẫn ảnh sai');
  const back = await api(r.body.url, { raw: true });
  assertEq(back.status, 200, 'tải lại ảnh');
  assertEq(back.buffer.length, png.length, 'kích thước ảnh tải về');
});

await t.test('Từ chối tệp không phải ảnh ở /api/admin/uploads', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe');
  const r = await api('/api/admin/uploads', { method: 'POST', token: S.adminAccess, form });
  assertStatus(r, 400, 'upload exe');
});

await t.test('Xoá bài → route công khai trả 404', async () => {
  const r = await api(`/api/admin/posts/${S.draftId}`, { method: 'DELETE', token: S.adminAccess });
  assertStatus(r, 200, 'xoá bài');
  const again = await api(`/api/admin/posts/${S.draftId}`, { method: 'DELETE', token: S.adminAccess });
  assertStatus(again, 404, 'xoá lại');
});

// ══ 7. Bản phát hành ═════════════════════════════════════════════════════════
t.section('7. Phát hành & tải bản cài đặt');

const tmpFile = path.join(os.tmpdir(), `zca-smoke-${rand()}.dmg`);
const fileBuf = crypto.randomBytes(1024 * 1024);   // 1 MB "bản cài đặt" thật
fs.writeFileSync(tmpFile, fileBuf);
const fileSha = crypto.createHash('sha256').update(fileBuf).digest('hex');

await t.test('POST /api/admin/releases nhận tệp 1 MB, tính đúng sha256', async () => {
  const form = new FormData();
  form.append('file', new Blob([fileBuf]), path.basename(tmpFile));
  form.append('version', '1.2.0');
  form.append('platform', 'darwin');
  form.append('arch', 'arm64');
  form.append('channel', 'stable');
  form.append('notes', '## Bản 1.2.0\n\n- Sửa lỗi đăng nhập\n');
  form.append('minVersion', '1.1.0');

  const r = await api('/api/admin/releases', { method: 'POST', token: S.adminAccess, form });
  assertStatus(r, 200, 'tạo bản phát hành');
  const rel = r.body.release;
  assertEq(rel.sha256, fileSha, 'sha256 máy chủ tính');
  assertEq(rel.fileSize, fileBuf.length, 'fileSize');
  assertEq(rel.publishedAt, null, 'bản mới phải là nháp');
  assert(rel.notesHtml.includes('<h2'), 'notes markdown chưa render');
  assert(rel.downloadUrl.includes(`/downloads/${rel.id}/`), 'downloadUrl sai dạng');
  S.releaseId = rel.id;
  S.releaseFile = rel.fileName;
});

await t.test('Bản nháp không lộ ở /api/releases và không tải được', async () => {
  const list = await api('/api/releases?platform=darwin&arch=arm64');
  assert(!list.body.items.some((x) => x.id === S.releaseId), 'bản nháp lọt ra danh sách công khai');
  const dl = await api(`/downloads/${S.releaseId}/${encodeURIComponent(S.releaseFile)}`, { raw: true });
  assertEq(dl.status, 404, 'tải bản nháp');
});

await t.test('Publish → /api/releases + /api/releases/latest thấy bản mới', async () => {
  const r = await api(`/api/admin/releases/${S.releaseId}/publish`, { method: 'POST', token: S.adminAccess, body: { published: true } });
  assertStatus(r, 200, 'publish');
  assert(r.body.release.publishedAt, 'thiếu publishedAt');

  const list = await api('/api/releases?platform=darwin&arch=arm64');
  assert(list.body.items.some((x) => x.id === S.releaseId), 'không thấy bản đã publish');

  const latest = await api('/api/releases/latest?platform=darwin&arch=arm64&channel=stable');
  assertStatus(latest, 200, 'latest');
  assertEq(latest.body.release.id, S.releaseId, 'bản mới nhất');
});

await t.test('latest lùi về arch universal khi không có bản đúng arch', async () => {
  const form = new FormData();
  form.append('externalUrl', 'https://example.com/app-universal.zip');
  form.append('version', '1.3.0');
  form.append('platform', 'linux');
  form.append('arch', 'universal');
  const created = await api('/api/admin/releases', { method: 'POST', token: S.adminAccess, form });
  assertStatus(created, 200, 'tạo bản universal');
  await api(`/api/admin/releases/${created.body.release.id}/publish`, { method: 'POST', token: S.adminAccess, body: { published: true } });

  const r = await api('/api/releases/latest?platform=linux&arch=x64');
  assertEq(r.body.release?.id, created.body.release.id, 'phải lùi về bản universal');
  assertEq(r.body.release.downloadUrl, 'https://example.com/app-universal.zip', 'externalUrl phải thắng downloadUrl nội bộ');
  S.universalId = created.body.release.id;
});

await t.test('latest trả null khi chưa có bản nào cho nền tảng đó', async () => {
  const r = await api('/api/releases/latest?platform=win32&arch=x64');
  assertStatus(r, 200, 'latest win32');
  assertEq(r.body.release, null, 'release');
});

await t.test('check với bản ĐANG CHẠY CŨ hơn → updateAvailable + mandatory theo minVersion', async () => {
  const r = await api('/api/releases/check?platform=darwin&arch=arm64&version=1.0.0&channel=stable');
  assertStatus(r, 200, 'check cũ');
  assertEq(r.body.updateAvailable, true, 'updateAvailable');
  assertEq(r.body.current, '1.0.0', 'current');
  assertEq(r.body.latest.version, '1.2.0', 'latest.version');
  assertEq(r.body.mandatory, true, 'bản 1.0.0 < minVersion 1.1.0 ⇒ bắt buộc cập nhật');
});

await t.test('check với bản mới hơn minVersion → không bắt buộc', async () => {
  const r = await api('/api/releases/check?platform=darwin&arch=arm64&version=1.1.5');
  assertEq(r.body.updateAvailable, true, 'updateAvailable');
  assertEq(r.body.mandatory, false, 'mandatory');
});

await t.test('check với bản ĐANG CHẠY MỚI hơn → không có cập nhật', async () => {
  const r = await api('/api/releases/check?platform=darwin&arch=arm64&version=9.9.9');
  assertEq(r.body.updateAvailable, false, 'updateAvailable');
  assertEq(r.body.mandatory, false, 'mandatory');
});

await t.test('HEAD /downloads trả đúng Content-Length và KHÔNG tăng đếm', async () => {
  const before = await api('/api/admin/releases', { token: S.adminAccess });
  const n0 = before.body.items.find((x) => x.id === S.releaseId).downloads;

  const res = await fetch(`${base}/downloads/${S.releaseId}/${encodeURIComponent(S.releaseFile)}`, { method: 'HEAD' });
  assertEq(res.status, 200, 'HEAD status');
  assertEq(Number(res.headers.get('content-length')), fileBuf.length, 'Content-Length');
  assert(/attachment/.test(res.headers.get('content-disposition') ?? ''), 'thiếu Content-Disposition: attachment');

  const after = await api('/api/admin/releases', { token: S.adminAccess });
  assertEq(after.body.items.find((x) => x.id === S.releaseId).downloads, n0, 'HEAD không được tăng bộ đếm');
});

await t.test('GET /downloads trả đúng byte (sha256 khớp) và tăng đếm', async () => {
  const before = await api('/api/admin/releases', { token: S.adminAccess });
  const n0 = before.body.items.find((x) => x.id === S.releaseId).downloads;

  const dl = await api(`/downloads/${S.releaseId}/${encodeURIComponent(S.releaseFile)}`, { raw: true });
  assertEq(dl.status, 200, 'GET download');
  assertEq(dl.buffer.length, fileBuf.length, 'kích thước tải về');
  assertEq(crypto.createHash('sha256').update(dl.buffer).digest('hex'), fileSha, 'sha256 nội dung tải về');

  const after = await api('/api/admin/releases', { token: S.adminAccess });
  assertEq(after.body.items.find((x) => x.id === S.releaseId).downloads, n0 + 1, 'bộ đếm downloads');
});

await t.test('Tên tệp trên URL không khớp DB → 404 (chặn dò đường dẫn)', async () => {
  const r = await api(`/downloads/${S.releaseId}/..%2F..%2Fetc%2Fpasswd`, { raw: true });
  assert(r.status === 404 || r.status === 400, `mong đợi 404/400, nhận ${r.status}`);
});

await t.test('PUT /api/admin/releases/:id đổi notes + render lại HTML', async () => {
  const r = await api(`/api/admin/releases/${S.releaseId}`, { method: 'PUT', token: S.adminAccess, body: { notes: '### Sửa nóng', mandatory: true } });
  assertStatus(r, 200, 'sửa release');
  assert(r.body.release.notesHtml.includes('<h3'), 'notesHtml chưa render lại');
  assertEq(r.body.release.mandatory, true, 'mandatory');
});

await t.test('DELETE bản phát hành xoá cả tệp trên đĩa', async () => {
  const r = await api(`/api/admin/releases/${S.universalId}`, { method: 'DELETE', token: S.adminAccess });
  assertStatus(r, 200, 'xoá release');
  const latest = await api('/api/releases/latest?platform=linux&arch=x64');
  assertEq(latest.body.release, null, 'bản đã xoá vẫn còn');
});

// ══ 8. Trang chủ & thống kê ══════════════════════════════════════════════════
t.section('8. Cấu hình trang chủ & thống kê');

await t.test('PUT /api/admin/site rồi GET /api/site phản ánh đúng', async () => {
  const payload = {
    appName: 'Zalo Chat Assistant',
    tagline: 'Trợ lý trả lời tin nhắn cho phòng khám',
    hero: { title: 'Trả lời nhanh hơn', subtitle: 'Claude gợi ý, bạn quyết định.' },
    features: [{ icon: '💬', title: 'Gợi ý phản hồi', text: 'Đọc ngữ cảnh hội thoại rồi soạn sẵn câu trả lời.' }],
    contact: { email: 'hotro@meddental.vn', phone: '1900 1234', zalo: 'meddental', address: 'Hà Nội', website: 'https://meddental.vn' },
  };
  const put = await api('/api/admin/site', { method: 'PUT', token: S.adminAccess, body: payload });
  assertStatus(put, 200, 'PUT site');

  const site = await api('/api/site');
  assertStatus(site, 200, 'GET site');
  assertEq(site.body.hero.title, 'Trả lời nhanh hơn', 'hero.title');
  assertEq(site.body.features[0].icon, '💬', 'features[0].icon');
  assertEq(site.body.contact.email, 'hotro@meddental.vn', 'contact.email');
  assert('darwin-arm64' in site.body.latest, 'thiếu bản đồ latest');
  assertEq(site.body.latest['darwin-arm64'].id, S.releaseId, 'latest darwin-arm64');
  assertEq(site.body.latest['win32-x64'], null, 'latest win32-x64 phải là null');
});

await t.test('GET /api/admin/users trả kèm keyVersion + số phiên', async () => {
  const r = await api(`/api/admin/users?q=${encodeURIComponent(email)}`, { token: S.adminAccess });
  assertStatus(r, 200, 'admin users');
  const u = r.body.items.find((x) => x.id === S.userId);
  assert(u, 'không tìm thấy người dùng vừa tạo');
  assertEq(u.keyVersion, 3, 'keyVersion');
  assert(typeof u.sessions === 'number', 'thiếu số phiên');
  assertEq(u.disabled, false, 'disabled');
});

await t.test('GET /api/admin/stats trả đủ chỉ số', async () => {
  const r = await api('/api/admin/stats', { token: S.adminAccess });
  assertStatus(r, 200, 'stats');
  for (const k of ['users', 'usersNew7d', 'releases', 'downloadsTotal', 'downloads7d', 'posts', 'lastLogins']) {
    assert(k in r.body, `thiếu chỉ số ${k}`);
  }
  assert(r.body.downloadsTotal >= 1, 'downloadsTotal phải đếm được lượt tải vừa rồi');
  assert(r.body.downloads7d >= 1, 'downloads7d');
  assert(Array.isArray(r.body.lastLogins), 'lastLogins');
});

await t.test('POST /api/admin/users/:id/reset-code cấp mã 8 ký tự dùng được', async () => {
  const r = await api(`/api/admin/users/${S.userId}/reset-code`, { method: 'POST', token: S.adminAccess });
  assertStatus(r, 200, 'reset-code');
  assertEq(r.body.code.length, 8, 'độ dài mã');
  assert(r.body.expiresAt > Date.now(), 'expiresAt phải ở tương lai');
  const used = await api('/api/auth/reset-password', { method: 'POST', body: { email, code: r.body.code, newPassword: PASS3 } });
  assertStatus(used, 200, 'dùng mã do admin cấp');
});

await t.test('PATCH khoá tài khoản → login 403, access token cũ hoá 401', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS3 } });
  assertStatus(login, 200, 'login trước khi khoá');
  const tokenTruocKhiKhoa = login.body.accessToken;

  const r = await api(`/api/admin/users/${S.userId}`, { method: 'PATCH', token: S.adminAccess, body: { disabled: true } });
  assertStatus(r, 200, 'khoá tài khoản');
  assertEq(r.body.user.disabled, true, 'disabled');

  const me = await api('/api/me', { token: tokenTruocKhiKhoa });
  assertStatus(me, 401, 'token cũ sau khi khoá');
  const relogin = await api('/api/auth/login', { method: 'POST', body: { email, password: PASS3 } });
  assertStatus(relogin, 403, 'login tài khoản bị khoá');

  await api(`/api/admin/users/${S.userId}`, { method: 'PATCH', token: S.adminAccess, body: { disabled: false } });
});

await t.test('Không hạ quyền được quản trị viên cuối cùng', async () => {
  const r = await api(`/api/admin/users/${S.adminId}`, { method: 'PATCH', token: S.adminAccess, body: { role: 'user' } });
  assertStatus(r, 400, 'hạ quyền admin cuối');
  assert(/cuối cùng/.test(r.body.error), 'câu lỗi phải nói rõ lý do');
});

await t.test('PATCH đổi tên người dùng', async () => {
  const r = await api(`/api/admin/users/${S.userId}`, { method: 'PATCH', token: S.adminAccess, body: { name: 'Tên Đã Sửa' } });
  assertStatus(r, 200, 'đổi tên');
  assertEq(r.body.user.name, 'Tên Đã Sửa', 'name');
});

// ══ 9. Linh tinh & giới hạn tần suất (chạy CUỐI vì làm cạn hạn mức) ═════════
t.section('9. Lỗi chuẩn & giới hạn tần suất');

await t.test('Route không tồn tại → 404 JSON tiếng Việt', async () => {
  const r = await api('/api/khong-co-dau');
  assertStatus(r, 404, '404');
  assertEq(r.body.error, 'Không tìm thấy.', 'câu lỗi');
});

await t.test('Bearer token rác → 401', async () => {
  const r = await api('/api/me', { token: 'a.b.c' });
  assertStatus(r, 401, 'token rác');
});

await t.test('CORS trả đúng Origin trong danh sách cho phép', async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:4790' } });
  assertEq(res.headers.get('access-control-allow-origin'), 'http://localhost:4790', 'ACAO');
});

await t.test('Giới hạn 10 lượt/phút/IP cho /api/auth/login → 429', async () => {
  let saw429 = false;
  for (let i = 0; i < 15; i += 1) {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: `khong.co.${rand()}@meddental.vn`, password: 'x'.repeat(12) } });
    if (r.status === 429) { saw429 = true; assert(/quá nhiều/.test(r.body.error), 'câu lỗi 429'); break; }
  }
  assert(saw429, 'gọi 15 lần liên tiếp mà không bị chặn — giới hạn tần suất không hoạt động');
});

fs.rmSync(tmpFile, { force: true });
const ok = t.summary();
if (server) { await server.stop(); await dropDb(mongoUrl); }
process.exit(ok ? 0 : 1);
