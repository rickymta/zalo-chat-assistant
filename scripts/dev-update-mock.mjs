/**
 * Máy chủ cập nhật GIẢ để thử tính năng "Kiểm tra bản cập nhật" mà không cần dựng platform/api.
 * Chỉ dùng khi phát triển — không đóng gói vào ứng dụng.
 *
 * Chạy:   node scripts/dev-update-mock.mjs            (bản thường 9.9.9)
 *         MANDATORY=1 node scripts/dev-update-mock.mjs (bản BẮT BUỘC)
 *         PORT=4796 node scripts/dev-update-mock.mjs
 *
 * Đổi kiểu ngay lúc đang chạy (không phải khởi động lại):
 *         curl 'http://127.0.0.1:4796/mock/mode?mandatory=1'   → bản bắt buộc
 *         curl 'http://127.0.0.1:4796/mock/mode?mandatory=0'   → bản thường
 *         curl 'http://127.0.0.1:4796/mock/mode?version=1.0.0' → không có bản mới
 *
 * Đường dẫn phục vụ (theo platform/API-CONTRACT.md mục 3):
 *   GET /api/releases/check?platform=&arch=&version=&channel=
 *   GET /downloads/x/test.dmg   — file giả để thử nút "Tải về"
 *   GET /health
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4796);
const HOST = '127.0.0.1';
const FILE_BODY = Buffer.from('Zalo Chat Assistant — file .dmg GIẢ dùng để thử luồng cập nhật.\n');

const mode = {
  version: process.env.MOCK_VERSION || '9.9.9',
  mandatory: process.env.MANDATORY === '1',
};

const NOTES = [
  '## Có gì mới',
  '',
  '- Thêm **kiểm tra bản cập nhật** trong Cài đặt',
  '- Thanh báo bản mới ở đầu màn hình',
  '- Sửa lỗi mất kết nối sau khi máy ngủ',
  '',
  '> Bản thử dùng cho máy chủ giả — không phải bản phát hành thật.',
].join('\n');

const NOTES_HTML = '<h2>Có gì mới</h2><ul><li>Thêm <strong>kiểm tra bản cập nhật</strong> trong Cài đặt</li>'
  + '<li>Thanh báo bản mới ở đầu màn hình</li><li>Sửa lỗi mất kết nối sau khi máy ngủ</li></ul>'
  + '<p>Bản thử dùng cho máy chủ giả — không phải bản phát hành thật.</p>';

const sha256 = crypto.createHash('sha256').update(FILE_BODY).digest('hex');

function release() {
  return {
    id: 'mock-release',
    version: mode.version,
    channel: 'stable',
    platform: process.platform,
    arch: process.arch,
    fileName: 'test.dmg',
    fileSize: 128 * 1024 * 1024,     // 128 MB (số giả cho đẹp thanh báo)
    sha256,
    downloadUrl: `http://${HOST}:${PORT}/downloads/x/test.dmg`,
    notes: NOTES,
    notesHtml: NOTES_HTML,
    mandatory: mode.mandatory,
    minVersion: mode.mandatory ? mode.version : undefined,
    publishedAt: Date.now() - 3600e3,
    downloads: 0,
  };
}

/** So semver rất gọn — chỉ cần đủ để máy chủ giả trả đúng `updateAvailable`. */
function newer(a, b) {
  const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const json = (res, code, body) => {
  const b = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
};

http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  console.log(`[mock] ${req.method} ${req.url}`);

  if (u.pathname === '/health') return json(res, 200, { status: 'ok', users: 0, smtp: false, version: 'mock' });

  if (u.pathname === '/mock/mode') {
    if (u.searchParams.has('mandatory')) mode.mandatory = u.searchParams.get('mandatory') === '1';
    if (u.searchParams.has('version')) mode.version = u.searchParams.get('version');
    console.log(`[mock] đổi kiểu → phiên bản ${mode.version}, bắt buộc: ${mode.mandatory}`);
    return json(res, 200, { ok: true, ...mode });
  }

  if (u.pathname === '/api/releases/check') {
    const current = u.searchParams.get('version') || '0.0.0';
    const up = newer(mode.version, current);
    return json(res, 200, {
      updateAvailable: up,
      current,
      latest: up ? release() : null,
      mandatory: up && mode.mandatory,
    });
  }

  if (u.pathname === '/api/releases/latest') return json(res, 200, { release: release() });

  if (u.pathname === '/downloads/x/test.dmg') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="test.dmg"', 'Content-Length': FILE_BODY.length });
    return res.end(req.method === 'HEAD' ? undefined : FILE_BODY);
  }

  return json(res, 404, { error: 'Không có đường dẫn này trong máy chủ giả.' });
}).listen(PORT, HOST, () => {
  console.log(`[mock] Máy chủ cập nhật giả: http://${HOST}:${PORT} — phiên bản ${mode.version}${mode.mandatory ? ' (BẮT BUỘC)' : ''}`);
});
