#!/usr/bin/env node
/**
 * Máy chủ MOCK cho nhóm web — trả dữ liệu mẫu ĐÚNG theo platform/API-CONTRACT.md.
 *
 * Mục đích: phát triển và tự kiểm thử giao diện mà không phải chờ nhóm api.
 * KHÔNG dùng cho production: mật khẩu để trần trong bộ nhớ, token không ký, dữ liệu mất khi tắt.
 *
 *   node scripts/mock-api.mjs            # nghe cổng 4791
 *   PORT=4795 node scripts/mock-api.mjs  # đổi cổng (nhớ đổi ZCA_API_PORT cho vite)
 *
 * Tài khoản mẫu:
 *   admin@meddental.vn / 12345678  → vai trò admin
 *   tuvan@meddental.vn / 12345678  → vai trò user
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { marked } from 'marked';

const PORT = Number(process.env.PORT || 4791);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const ACCESS_TTL_SEC = 900;
const REFRESH_TTL_DAYS = 30;

marked.setOptions({ breaks: true, gfm: true });
const md = (s) => marked.parse(String(s || ''));

const now = () => Date.now();
const day = 86_400_000;
const uid = () => crypto.randomUUID();

/* ───────────────────────── Dữ liệu mẫu trong bộ nhớ ───────────────────────── */

const users = [
  {
    id: uid(),
    email: 'admin@meddental.vn',
    password: '12345678',
    name: 'Quản trị viên',
    role: 'admin',
    disabled: false,
    createdAt: now() - 120 * day,
    lastLoginAt: now() - 2 * 3600_000,
  },
  {
    id: uid(),
    email: 'tuvan@meddental.vn',
    password: '12345678',
    name: 'Nguyễn Thị Tư Vấn',
    role: 'user',
    disabled: false,
    createdAt: now() - 40 * day,
    lastLoginAt: now() - 26 * 3600_000,
  },
  {
    id: uid(),
    email: 'nghiviec@meddental.vn',
    password: '12345678',
    name: 'Trần Văn Nghỉ',
    role: 'user',
    disabled: true,
    createdAt: now() - 200 * day,
    lastLoginAt: now() - 90 * day,
  },
];

/** userId → [{ version, key, source, createdAt }] */
const keys = new Map();
users.forEach((u, i) => {
  keys.set(u.id, [
    { version: 1, key: randomKey(), source: 'server', createdAt: u.createdAt },
    ...(i === 1 ? [{ version: 2, key: randomKey(), source: 'server', createdAt: now() - 10 * day }] : []),
  ]);
});

/** refreshToken → { token, userId, device, createdAt, expiresAt, revoked } */
const sessions = new Map();
// Một phiên sẵn có cho tài khoản tư vấn viên, để màn "Phiên đăng nhập" không trống.
sessions.set('seed-app-session', {
  token: 'seed-app-session',
  userId: users[1].id,
  device: 'Zalo Chat Assistant trên macOS',
  createdAt: now() - 12 * day,
  expiresAt: now() + 18 * day,
});

/** email → { code, expiresAt, tries } */
const resetCodes = new Map();

const NOTES_120 = `### Mới
- **Báo cáo ngày**: tổng hợp toàn bộ hội thoại trong ngày, việc cần làm, câu chưa trả lời.
- Cột trợ lý hiện gợi ý của Claude ngay cạnh hội thoại.

### Sửa lỗi
- Không còn mất kết nối Zalo sau khi máy thức dậy.
- Sửa lỗi hiển thị sticker và ảnh GIF.`;

const releases = [
  mkRelease({
    version: '1.2.0',
    platform: 'darwin',
    arch: 'arm64',
    fileName: 'Zalo Chat Assistant-1.2.0-arm64.dmg',
    fileSize: 128 * 1024 * 1024,
    notes: NOTES_120,
    publishedAt: now() - 3 * day,
    downloads: 143,
  }),
  mkRelease({
    version: '1.2.0',
    platform: 'darwin',
    arch: 'x64',
    fileName: 'Zalo Chat Assistant-1.2.0-x64.dmg',
    fileSize: 134 * 1024 * 1024,
    notes: NOTES_120,
    publishedAt: now() - 3 * day,
    downloads: 37,
  }),
  mkRelease({
    version: '1.2.0',
    platform: 'win32',
    arch: 'x64',
    fileName: 'Zalo Chat Assistant-Setup-1.2.0-x64.exe',
    fileSize: 96 * 1024 * 1024,
    notes: NOTES_120,
    publishedAt: now() - 2 * day,
    downloads: 12,
  }),
  mkRelease({
    version: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    fileName: 'Zalo Chat Assistant-1.1.0-arm64.dmg',
    fileSize: 122 * 1024 * 1024,
    notes: '### Mới\n- Xuất dữ liệu ra Excel.\n- Nhớ vị trí cuộn khi mở lại hội thoại.',
    publishedAt: now() - 30 * day,
    downloads: 208,
    mandatory: true,
    minVersion: '1.0.0',
  }),
  mkRelease({
    version: '1.3.0',
    platform: 'darwin',
    arch: 'arm64',
    fileName: 'Zalo Chat Assistant-1.3.0-arm64.dmg',
    fileSize: 131 * 1024 * 1024,
    notes: '### Thử nghiệm\n- Tự tổng hợp theo lịch của Claude Cowork.',
    channel: 'beta',
    publishedAt: now() - 1 * day,
    downloads: 4,
  }),
  mkRelease({
    version: '1.4.0',
    platform: 'darwin',
    arch: 'arm64',
    fileName: 'Zalo Chat Assistant-1.4.0-arm64.dmg',
    fileSize: 133 * 1024 * 1024,
    notes: '### Nháp\n- Bản này chưa xuất bản, chỉ admin thấy.',
    publishedAt: null,
    downloads: 0,
  }),
];

const posts = [
  mkPost({
    title: 'Đã phát hành bản 1.2.0 — có Báo cáo ngày',
    slug: 'da-phat-hanh-ban-1-2-0',
    excerpt: 'Bản 1.2.0 thêm hộp thoại Báo cáo ngày, tổng hợp toàn bộ hội thoại và việc cần làm.',
    contentMd: `Bản **1.2.0** đã có mặt trên trang Tải về.

## Báo cáo ngày

Bấm nút 📊 ở thanh trên để xem tổng hợp trong ngày:

- Số hội thoại, tin đến, tin đi, hội thoại chưa trả lời
- Phần *Tổng quan* và *Việc cần làm* do Claude viết
- Từng hội thoại một thẻ: quan hệ, tóm tắt, chủ đề, việc của bạn

## Cách cập nhật

Tải bản mới ở trang [Tải về](/tai-ve), kéo vào Applications và cài đè. Dữ liệu và phiên đăng nhập được giữ nguyên.`,
    tags: ['phát hành', 'tính năng'],
    pinned: true,
    publishedAt: now() - 3 * day,
  }),
  mkPost({
    title: 'Mẹo: để ứng dụng chạy nền cả ngày mà không lỡ tin',
    slug: 'meo-de-ung-dung-chay-nen',
    excerpt: 'Bật hai công tắc trong Cài đặt là gần như không bao giờ mất tin nhắn.',
    contentMd: `Hai công tắc nên bật ngay sau khi cài:

1. **Tự mở ứng dụng khi bật máy**
2. **Giữ máy không ngủ khi ứng dụng chạy**

> Khoá màn hình KHÔNG ảnh hưởng — ứng dụng vẫn nhận và lưu tin. Chỉ khi máy *ngủ* thì Zalo mới mất kết nối.

Máy thức dậy, ứng dụng tự nối lại và xin Zalo gửi bù các tin bỏ lỡ.`,
    tags: ['mẹo'],
    publishedAt: now() - 12 * day,
  }),
  mkPost({
    title: 'Vì sao hội thoại 1-1 không có tin nhắn cũ?',
    slug: 'vi-sao-khong-co-tin-nhan-cu',
    excerpt: 'Zalo không cung cấp API lấy lịch sử hội thoại 1-1, nên ứng dụng chỉ lưu từ lúc kết nối.',
    contentMd: `Zalo **không** có API lịch sử cho hội thoại 1-1. Ứng dụng chỉ ghi được tin từ thời điểm bạn quét mã QR trở đi (cộng phần Zalo gửi bù khi nối lại).

Với **nhóm chat**, ứng dụng có thử hỏi lịch sử gần đây, nhưng Zalo hiện trả về rỗng — nên cũng đừng trông vào lịch sử nhóm.

**Kết luận:** kết nối càng sớm, dữ liệu cho Claude càng đầy đủ.`,
    tags: ['câu hỏi thường gặp', 'zalo'],
    publishedAt: now() - 20 * day,
  }),
  mkPost({
    title: 'Hướng dẫn cài đặt trên macOS',
    slug: 'huong-dan-cai-dat-macos',
    excerpt: 'Từ tải file .dmg đến lần mở đầu tiên, kèm cách xử lý khi macOS chặn ứng dụng chưa ký.',
    kind: 'page',
    contentMd: `## 1. Tải và cài

Mở file \`.dmg\`, kéo **Zalo Chat Assistant** vào thư mục **Applications**.

## 2. Lần đầu mở

macOS chặn ứng dụng chưa ký số. **Chuột phải vào ứng dụng → Mở**, rồi bấm **Mở** ở hộp thoại.

Vẫn bị chặn thì chạy trong Terminal:

\`\`\`bash
xattr -dr com.apple.quarantine "/Applications/Zalo Chat Assistant.app"
\`\`\`

## 3. Chọn đúng chip

| Máy | Bản cần tải |
|---|---|
| Mac chip Apple (M1/M2/M3…) | \`arm64\` |
| Mac Intel | \`x64\` |

Xem chip ở **menu Apple → Giới thiệu về máy Mac này**.`,
    tags: ['cài đặt', 'macos'],
    pinned: true,
    publishedAt: now() - 25 * day,
  }),
  mkPost({
    title: 'Kết nối Claude Cowork với thư mục làm việc',
    slug: 'ket-noi-claude-cowork',
    excerpt: 'Trỏ Cowork vào thư mục làm việc một lần, sau đó chỉ cần bấm Cập nhật dữ liệu cho Claude.',
    kind: 'page',
    contentMd: `## Trỏ Cowork một lần

Mở Claude desktop, trỏ Cowork vào:

\`\`\`
~/Documents/Zalo Chat Assistant
\`\`\`

## Mỗi lần muốn Claude làm việc

1. Trong ứng dụng bấm **📁 Cập nhật dữ liệu cho Claude**, chọn phạm vi (khách đang chờ / hôm nay / 7 ngày / nhóm / tất cả).
2. Nhắn Cowork: *"Đọc \`huong-dan/00-chi-dan-cho-claude.md\` rồi tổng hợp tất cả hội thoại trong du-lieu/ và đề xuất phản hồi."*
3. Claude ghi kết quả vào \`ket-qua/\`. Hội thoại có gợi ý sẽ hiện nhãn **💡 Có gợi ý**.`,
    tags: ['claude', 'cowork'],
    publishedAt: now() - 18 * day,
  }),
  mkPost({
    title: 'Bài nháp — chưa xuất bản',
    slug: 'bai-nhap-chua-xuat-ban',
    excerpt: 'Bài này chỉ hiện trong khu quản trị để kiểm tra trạng thái nháp.',
    contentMd: 'Nội dung nháp.',
    publishedAt: null,
  }),
];

let site = {
  appName: 'Zalo Chat Assistant',
  tagline: 'Trợ lý hội thoại Zalo cho tư vấn viên',
  hero: {
    title: 'Không bỏ lỡ khách nào trên Zalo',
    subtitle:
      'Kết nối Zalo cá nhân bằng mã QR, lưu mọi tin nhắn vào máy ở dạng mã hoá, để Claude Cowork tổng hợp hội thoại và đề xuất câu trả lời — bạn chỉ việc sửa lại và bấm Gửi.',
  },
  features: [
    { icon: '📱', title: 'Kết nối bằng mã QR', text: 'Quét một lần như Zalo Web. Ứng dụng chạy nền, tự nối lại khi máy thức.' },
    { icon: '🔐', title: 'Mã hoá ngay trên máy', text: 'Tin nhắn, tên, số điện thoại mã hoá AES-256-GCM. Máy chủ không bao giờ nhận tin nhắn.' },
    { icon: '💡', title: 'Gợi ý trả lời', text: 'Claude Cowork đọc hội thoại rồi đề xuất câu trả lời cho từng khách.' },
    { icon: '📊', title: 'Báo cáo ngày', text: 'Số hội thoại, tin chưa trả lời, việc cần làm — tổng hợp trong một hộp thoại.' },
    { icon: '🗂️', title: 'Thư mục làm việc', text: 'Hội thoại xuất ra Markdown/CSV/Excel để Claude đọc trực tiếp.' },
    { icon: '🔄', title: 'Tự báo bản mới', text: 'Ứng dụng kiểm tra cập nhật và dẫn thẳng tới trang tải về.' },
  ],
  contact: {
    email: 'hotro@meddental.vn',
    phone: '1900 6363',
    zalo: 'MedDental',
    address: 'MedDental — phòng CNTT',
  },
};

let downloadsTotal = releases.reduce((s, r) => s + r.downloads, 0);

/* ───────────────────────────── Hàm dựng dữ liệu ──────────────────────────── */

function randomKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function mkRelease(o) {
  const id = uid();
  const r = {
    id,
    version: o.version,
    channel: o.channel || 'stable',
    platform: o.platform,
    arch: o.arch,
    fileName: o.fileName,
    fileSize: o.fileSize,
    sha256: crypto.createHash('sha256').update(`${o.fileName}${o.version}`).digest('hex'),
    externalUrl: o.externalUrl || null,
    notes: o.notes || '',
    notesHtml: md(o.notes || ''),
    mandatory: !!o.mandatory,
    minVersion: o.minVersion || null,
    publishedAt: o.publishedAt === undefined ? now() : o.publishedAt,
    downloads: o.downloads || 0,
    createdAt: now() - 5 * day,
    createdBy: 'admin@meddental.vn',
  };
  r.downloadUrl = r.externalUrl || `${PUBLIC_URL}/downloads/${id}/${encodeURIComponent(r.fileName)}`;
  return r;
}

function mkPost(o) {
  return {
    id: uid(),
    slug: o.slug,
    title: o.title,
    excerpt: o.excerpt || '',
    contentMd: o.contentMd || '',
    contentHtml: md(o.contentMd || ''),
    coverImageUrl: o.coverImageUrl || null,
    tags: o.tags || [],
    kind: o.kind || 'post',
    pinned: !!o.pinned,
    publishedAt: o.publishedAt === undefined ? now() : o.publishedAt,
    authorId: users[0] ? users[0].id : null,
    createdAt: now() - 30 * day,
    updatedAt: now() - 2 * day,
  };
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

function issueSession(user, device) {
  const token = crypto.randomBytes(32).toString('base64url');
  const s = {
    token,
    userId: user.id,
    device: device || 'Không rõ thiết bị',
    createdAt: now(),
    expiresAt: now() + REFRESH_TTL_DAYS * day,
  };
  sessions.set(token, s);
  return s;
}

function authPayload(user, session) {
  const list = keys.get(user.id) || [];
  const current = list.length ? list[list.length - 1] : null;
  return {
    user: publicUser(user),
    accessToken: `mock.${user.id}.${now() + ACCESS_TTL_SEC * 1000}`,
    accessExpiresIn: ACCESS_TTL_SEC,
    refreshToken: session.token,
    encryptionKey: current ? { version: current.version, key: current.key } : null,
  };
}

/* ─────────────────────────────── Tiện ích HTTP ───────────────────────────── */

function send(res, status, body, headers = {}) {
  const payload = body === null || body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, error, code) => send(res, status, code ? { error, code } : { error });

function readBody(req, limit = 700 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Tệp quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 5 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

/** Parser multipart/form-data tối giản: đủ để lấy các trường text + tên/kích thước tệp. */
async function readMultipart(req) {
  const ct = req.headers['content-type'] || '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return { fields: {}, files: {} };
  const boundary = `--${m[1] || m[2]}`;
  const buf = await readBody(req);
  const fields = {};
  const files = {};

  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const partStart = start + boundary.length;
    if (buf.slice(partStart, partStart + 2).toString() === '--') break; // boundary kết thúc
    const headerEnd = buf.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const rawHeaders = buf.slice(partStart, headerEnd).toString('utf8');
    const next = buf.indexOf(`\r\n${boundary}`, headerEnd);
    const bodyEnd = next === -1 ? buf.length : next;
    const content = buf.slice(headerEnd + 4, bodyEnd);

    const nameMatch = rawHeaders.match(/name="([^"]*)"/i);
    const fileMatch = rawHeaders.match(/filename="([^"]*)"/i);
    const name = nameMatch ? nameMatch[1] : null;
    if (name) {
      if (fileMatch && fileMatch[1]) {
        files[name] = { fileName: fileMatch[1], size: content.length };
      } else {
        fields[name] = content.toString('utf8');
      }
    }
    start = next === -1 ? -1 : next + 2;
  }
  return { fields, files };
}

/** Lấy user từ Bearer token (token mock: `mock.<userId>.<hạn ms>`). */
function currentUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const parts = h.slice(7).split('.');
  if (parts.length !== 3 || parts[0] !== 'mock') return null;
  if (Number(parts[2]) < now()) return null; // hết hạn ⇒ để client tự gọi /refresh
  const u = users.find((x) => x.id === parts[1]);
  if (!u || u.disabled) return null;
  return u;
}

function requireUser(req, res) {
  const u = currentUser(req);
  if (!u) {
    fail(res, 401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'UNAUTHORIZED');
    return null;
  }
  return u;
}

function requireAdmin(req, res) {
  const u = requireUser(req, res);
  if (!u) return null;
  if (u.role !== 'admin') {
    fail(res, 403, 'Bạn không có quyền truy cập khu quản trị.', 'FORBIDDEN');
    return null;
  }
  return u;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function cmpSemverDesc(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

const lt = (a, b) => cmpSemverDesc(a, b) > 0; // a < b

/* ────────────────────────────────── Định tuyến ───────────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';
  const q = url.searchParams;

  if (method === 'OPTIONS') return send(res, 204, null);

  // Độ trễ giả để thấy được trạng thái "đang tải" trên giao diện.
  await new Promise((r) => setTimeout(r, 120));

  try {
    /* ── Sức khoẻ ── */
    if (path === '/health') {
      return send(res, 200, { status: 'ok', users: users.length, smtp: false, version: '1.2.0-mock' });
    }

    /* ── Xác thực ── */
    if (path === '/api/auth/register' && method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!email || !b.password) return fail(res, 400, 'Thiếu email hoặc mật khẩu.');
      if (String(b.password).length < 8) return fail(res, 400, 'Mật khẩu phải có ít nhất 8 ký tự.');
      if (users.some((u) => u.email.toLowerCase() === email)) {
        return fail(res, 409, 'Email này đã được đăng ký.', 'EMAIL_EXISTS');
      }
      // Mock: mã đăng ký đúng là "MEDDENTAL" (để trống cũng được).
      if (b.registrationCode && String(b.registrationCode).trim().toUpperCase() !== 'MEDDENTAL') {
        return fail(res, 403, 'Mã đăng ký không đúng. Liên hệ quản trị viên để được cấp mã.', 'BAD_CODE');
      }
      const user = {
        id: uid(),
        email,
        password: String(b.password),
        name: b.name ? String(b.name) : '',
        role: 'user',
        disabled: false,
        createdAt: now(),
        lastLoginAt: now(),
      };
      users.push(user);
      keys.set(user.id, [{ version: 1, key: randomKey(), source: 'server', createdAt: now() }]);
      return send(res, 200, authPayload(user, issueSession(user, b.device)));
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      const user = users.find((u) => u.email.toLowerCase() === email);
      if (!user || user.password !== String(b.password || '')) {
        return fail(res, 401, 'Email hoặc mật khẩu không đúng.', 'BAD_CREDENTIALS');
      }
      if (user.disabled) {
        return fail(res, 403, 'Tài khoản đã bị khoá. Liên hệ quản trị viên.', 'DISABLED');
      }
      user.lastLoginAt = now();
      return send(res, 200, authPayload(user, issueSession(user, b.device)));
    }

    if (path === '/api/auth/refresh' && method === 'POST') {
      const b = await readJson(req);
      const s = sessions.get(String(b.refreshToken || ''));
      if (!s || s.expiresAt < now()) {
        return fail(res, 401, 'Phiên đã hết hạn, vui lòng đăng nhập lại.', 'REFRESH_INVALID');
      }
      const user = users.find((u) => u.id === s.userId);
      if (!user || user.disabled) {
        return fail(res, 401, 'Tài khoản không còn hiệu lực.', 'REFRESH_INVALID');
      }
      // Xoay vòng: token cũ bị thu hồi, cấp token mới (giữ nguyên tên thiết bị và mốc tạo).
      sessions.delete(s.token);
      const fresh = issueSession(user, s.device);
      fresh.createdAt = s.createdAt;
      return send(res, 200, authPayload(user, fresh));
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const b = await readJson(req);
      sessions.delete(String(b.refreshToken || ''));
      return send(res, 200, { ok: true });
    }

    if (path === '/api/auth/forgot-password' && method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      const code = crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 8);
      if (users.some((u) => u.email.toLowerCase() === email)) {
        resetCodes.set(email, { code, expiresAt: now() + 30 * 60_000, tries: 0 });
        console.log(`[RESET-CODE] ${email} → ${code}`);
      }
      // Luôn 200 để không lộ email nào có trong hệ thống.
      return send(res, 200, { ok: true, delivery: 'server-log' });
    }

    if (path === '/api/auth/reset-password' && method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      const entry = resetCodes.get(email);
      if (!entry || entry.expiresAt < now()) {
        return fail(res, 400, 'Mã đặt lại không đúng hoặc đã hết hạn.', 'BAD_CODE');
      }
      entry.tries += 1;
      if (entry.tries > 5) {
        resetCodes.delete(email);
        return fail(res, 400, 'Bạn đã nhập sai quá 5 lần. Hãy xin mã mới.', 'TOO_MANY_TRIES');
      }
      if (String(b.code || '').trim().toUpperCase() !== entry.code) {
        return fail(res, 400, 'Mã đặt lại không đúng hoặc đã hết hạn.', 'BAD_CODE');
      }
      if (String(b.newPassword || '').length < 8) {
        return fail(res, 400, 'Mật khẩu mới phải có ít nhất 8 ký tự.');
      }
      const user = users.find((u) => u.email.toLowerCase() === email);
      user.password = String(b.newPassword);
      resetCodes.delete(email);
      // Thu hồi mọi phiên của người này.
      [...sessions.values()].filter((s) => s.userId === user.id).forEach((s) => sessions.delete(s.token));
      return send(res, 200, { ok: true });
    }

    /* ── Hồ sơ / phiên / khoá ── */
    if (path === '/api/me' && method === 'GET') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const list = keys.get(u.id) || [];
      return send(res, 200, {
        user: publicUser(u),
        keyVersion: list.length ? list[list.length - 1].version : null,
      });
    }

    if (path === '/api/me/change-password' && method === 'POST') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const b = await readJson(req);
      // Hợp đồng (đính chính 05/09/2026): dùng 400 chứ KHÔNG dùng 401 — 401 bị coi là hết
      // phiên nên client sẽ tự refresh rồi gọi lại, người dùng bị đăng xuất oan.
      if (u.password !== String(b.currentPassword || '')) {
        return fail(res, 400, 'Mật khẩu hiện tại không đúng.', 'BAD_PASSWORD');
      }
      if (String(b.newPassword || '').length < 8) {
        return fail(res, 400, 'Mật khẩu mới phải có ít nhất 8 ký tự.');
      }
      u.password = String(b.newPassword);
      return send(res, 200, { ok: true });
    }

    if (path === '/api/me/sessions' && method === 'GET') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const auth = req.headers.authorization || '';
      const items = [...sessions.values()]
        .filter((s) => s.userId === u.id && s.expiresAt > now())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({
          id: s.token,
          device: s.device,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          // Mock không biết chắc phiên nào là hiện tại ⇒ đánh dấu phiên web mới nhất.
          current: /web/i.test(s.device) && !!auth,
        }));
      return send(res, 200, { items });
    }

    const mSession = path.match(/^\/api\/me\/sessions\/(.+)$/);
    if (mSession && method === 'DELETE') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const id = decodeURIComponent(mSession[1]);
      const s = sessions.get(id);
      if (!s || s.userId !== u.id) return fail(res, 404, 'Không tìm thấy phiên đăng nhập này.');
      sessions.delete(id);
      return send(res, 200, { ok: true });
    }

    if (path === '/api/keys' && method === 'GET') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const list = [...(keys.get(u.id) || [])].sort((a, b) => b.version - a.version);
      const current = list[0] || null;
      return send(res, 200, {
        current: current ? { version: current.version, key: current.key } : null,
        versions: list,
      });
    }

    if (path === '/api/keys/rotate' && method === 'POST') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const list = keys.get(u.id) || [];
      const prev = list.length ? list[list.length - 1] : null;
      const next = { version: (prev ? prev.version : 0) + 1, key: randomKey(), source: 'server', createdAt: now() };
      list.push(next);
      keys.set(u.id, list);
      return send(res, 200, {
        current: { version: next.version, key: next.key },
        previous: prev ? { version: prev.version, key: prev.key } : null,
      });
    }

    if (path === '/api/keys' && method === 'PUT') {
      const u = requireUser(req, res);
      if (!u) return undefined;
      const b = await readJson(req);
      if (!b.key || String(b.key).length < 32) return fail(res, 400, 'Chuỗi mã hoá phải dài ít nhất 32 ký tự.');
      const list = keys.get(u.id) || [];
      const prev = list.length ? list[list.length - 1] : null;
      const next = {
        version: (prev ? prev.version : 0) + 1,
        key: String(b.key),
        source: 'client',
        createdAt: now(),
      };
      list.push(next);
      keys.set(u.id, list);
      return send(res, 200, {
        current: { version: next.version, key: next.key },
        previous: prev ? { version: prev.version, key: prev.key } : null,
      });
    }

    /* ── Phiên bản (công khai) ── */
    if (path === '/api/releases' && method === 'GET') {
      const channel = q.get('channel') || 'stable';
      const limit = Number(q.get('limit') || 50);
      let items = releases.filter((r) => r.publishedAt && r.channel === channel);
      if (q.get('platform')) items = items.filter((r) => r.platform === q.get('platform'));
      if (q.get('arch')) items = items.filter((r) => r.arch === q.get('arch'));
      items = items.sort((a, b) => cmpSemverDesc(a.version, b.version)).slice(0, limit);
      return send(res, 200, { items });
    }

    if (path === '/api/releases/latest' && method === 'GET') {
      const release = findLatest(q.get('platform'), q.get('arch'), q.get('channel') || 'stable');
      return send(res, 200, { release });
    }

    if (path === '/api/releases/check' && method === 'GET') {
      const current = q.get('version') || '0.0.0';
      const latest = findLatest(q.get('platform'), q.get('arch'), q.get('channel') || 'stable');
      const updateAvailable = !!latest && lt(current, latest.version);
      const mandatory = !!latest && (!!latest.mandatory || (!!latest.minVersion && lt(current, latest.minVersion)));
      return send(res, 200, { updateAvailable, current, latest, mandatory });
    }

    const mDownload = path.match(/^\/downloads\/([^/]+)\/(.+)$/);
    if (mDownload && (method === 'GET' || method === 'HEAD')) {
      const r = releases.find((x) => x.id === mDownload[1]);
      if (!r) return fail(res, 404, 'Không tìm thấy tệp cài đặt.');
      if (method === 'GET') {
        r.downloads += 1;
        downloadsTotal += 1;
      }
      // Mock không có tệp thật — trả một tệp văn bản nhỏ để trình duyệt vẫn tải được.
      const body = Buffer.from(
        `Đây là tệp giả của máy chủ mock cho ${r.fileName} (phiên bản ${r.version}).\n`,
        'utf8',
      );
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
        'Content-Disposition': `attachment; filename="${r.fileName}"`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(method === 'HEAD' ? undefined : body);
    }

    /* ── Cấu hình trang chủ (công khai) ── */
    if (path === '/api/site' && method === 'GET') {
      return send(res, 200, {
        ...site,
        latest: {
          'darwin-arm64': findLatest('darwin', 'arm64', 'stable'),
          'darwin-x64': findLatest('darwin', 'x64', 'stable'),
          'win32-x64': findLatest('win32', 'x64', 'stable'),
        },
      });
    }

    /* ── Bài viết (công khai) ── */
    if (path === '/api/posts' && method === 'GET') {
      const kind = q.get('kind') || 'post';
      const tag = q.get('tag');
      const page = Math.max(1, Number(q.get('page') || 1));
      const limit = Math.max(1, Number(q.get('limit') || 12));
      let items = posts.filter((p) => p.publishedAt && p.kind === kind);
      if (tag) items = items.filter((p) => (p.tags || []).includes(tag));
      items.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.publishedAt - a.publishedAt);
      const total = items.length;
      const slice = items.slice((page - 1) * limit, page * limit).map(stripContentMd);
      return send(res, 200, { items: slice, total, page, limit });
    }

    const mPostSlug = path.match(/^\/api\/posts\/([^/]+)$/);
    if (mPostSlug && method === 'GET') {
      const slug = decodeURIComponent(mPostSlug[1]);
      const p = posts.find((x) => x.slug === slug && x.publishedAt);
      if (!p) return fail(res, 404, 'Không tìm thấy bài viết này.', 'NOT_FOUND');
      return send(res, 200, { post: p });
    }

    /* ── Quản trị: bài viết ── */
    if (path === '/api/admin/posts' && method === 'GET') {
      if (!requireAdmin(req, res)) return undefined;
      const items = [...posts].sort((a, b) => (b.publishedAt || b.updatedAt) - (a.publishedAt || a.updatedAt));
      return send(res, 200, { items, total: items.length });
    }

    if (path === '/api/admin/posts' && method === 'POST') {
      const admin = requireAdmin(req, res);
      if (!admin) return undefined;
      const b = await readJson(req);
      if (!b.title) return fail(res, 400, 'Nhập tiêu đề bài viết.');
      const slug = String(b.slug || '').trim() || slugify(b.title);
      if (posts.some((p) => p.slug === slug)) return fail(res, 409, 'Slug này đã được dùng cho bài khác.');
      const p = {
        id: uid(),
        slug,
        title: String(b.title),
        excerpt: String(b.excerpt || ''),
        contentMd: String(b.contentMd || ''),
        contentHtml: md(b.contentMd || ''),
        coverImageUrl: b.coverImageUrl || null,
        tags: Array.isArray(b.tags) ? b.tags : [],
        kind: b.kind || 'post',
        pinned: !!b.pinned,
        publishedAt: b.publishedAt || null,
        authorId: admin.id,
        createdAt: now(),
        updatedAt: now(),
      };
      posts.unshift(p);
      return send(res, 200, { post: p });
    }

    const mAdminPost = path.match(/^\/api\/admin\/posts\/([^/]+)$/);
    if (mAdminPost && (method === 'PUT' || method === 'DELETE')) {
      if (!requireAdmin(req, res)) return undefined;
      const id = decodeURIComponent(mAdminPost[1]);
      const idx = posts.findIndex((p) => p.id === id);
      if (idx === -1) return fail(res, 404, 'Không tìm thấy bài viết này.');
      if (method === 'DELETE') {
        posts.splice(idx, 1);
        return send(res, 200, { ok: true });
      }
      const b = await readJson(req);
      const p = posts[idx];
      if (b.title !== undefined) p.title = String(b.title);
      if (b.slug !== undefined && String(b.slug).trim()) p.slug = String(b.slug).trim();
      if (b.excerpt !== undefined) p.excerpt = String(b.excerpt);
      if (b.contentMd !== undefined) {
        p.contentMd = String(b.contentMd);
        p.contentHtml = md(b.contentMd);
      }
      if (b.coverImageUrl !== undefined) p.coverImageUrl = b.coverImageUrl || null;
      if (b.tags !== undefined) p.tags = Array.isArray(b.tags) ? b.tags : [];
      if (b.kind !== undefined) p.kind = b.kind;
      if (b.pinned !== undefined) p.pinned = !!b.pinned;
      if (b.publishedAt !== undefined) p.publishedAt = b.publishedAt || null;
      p.updatedAt = now();
      return send(res, 200, { post: p });
    }

    /* ── Quản trị: tải ảnh ── */
    if (path === '/api/admin/uploads' && method === 'POST') {
      if (!requireAdmin(req, res)) return undefined;
      const { files } = await readMultipart(req);
      const f = files.file;
      if (!f) return fail(res, 400, 'Không nhận được tệp nào.');
      if (f.size > 10 * 1024 * 1024) return fail(res, 400, 'Ảnh không được vượt quá 10 MB.');
      // Mock: trả URL giả — trình duyệt sẽ nhận ảnh SVG chỗ dành sẵn ở /uploads/*.
      return send(res, 200, { url: `/uploads/${Date.now()}-${encodeURIComponent(f.fileName)}` });
    }

    // Ảnh giả cho mọi đường dẫn /uploads/* (để thẻ <img> không vỡ khi phát triển).
    if (path.startsWith('/uploads/')) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">
  <rect width="100%" height="100%" fill="#e8f0ff"/>
  <text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#0a66ff">Ảnh mẫu (mock)</text>
</svg>`;
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(svg);
    }

    /* ── Quản trị: phiên bản ── */
    if (path === '/api/admin/releases' && method === 'GET') {
      if (!requireAdmin(req, res)) return undefined;
      return send(res, 200, { items: releases, total: releases.length });
    }

    if (path === '/api/admin/releases' && method === 'POST') {
      const admin = requireAdmin(req, res);
      if (!admin) return undefined;
      const { fields, files } = await readMultipart(req);
      if (!fields.version) return fail(res, 400, 'Thiếu số phiên bản.');
      const f = files.file;
      if (!f && !fields.externalUrl) {
        return fail(res, 400, 'Cần tệp cài đặt hoặc liên kết ngoài.');
      }
      if (f && f.size > 600 * 1024 * 1024) {
        return fail(res, 413, 'Tệp vượt quá giới hạn 600 MB.');
      }
      const r = mkRelease({
        version: String(fields.version).trim(),
        channel: fields.channel || 'stable',
        platform: fields.platform || 'darwin',
        arch: fields.arch || 'arm64',
        fileName: f ? f.fileName : 'external',
        fileSize: f ? f.size : 0,
        notes: fields.notes || '',
        mandatory: fields.mandatory === 'true',
        minVersion: fields.minVersion || null,
        externalUrl: fields.externalUrl || null,
        publishedAt: null, // bản mới luôn ở trạng thái nháp
        downloads: 0,
      });
      r.createdBy = admin.email;
      releases.unshift(r);
      return send(res, 200, { release: r });
    }

    const mAdminRelease = path.match(/^\/api\/admin\/releases\/([^/]+)$/);
    if (mAdminRelease && (method === 'PUT' || method === 'DELETE')) {
      if (!requireAdmin(req, res)) return undefined;
      const id = decodeURIComponent(mAdminRelease[1]);
      const idx = releases.findIndex((r) => r.id === id);
      if (idx === -1) return fail(res, 404, 'Không tìm thấy bản phát hành này.');
      if (method === 'DELETE') {
        releases.splice(idx, 1);
        return send(res, 200, { ok: true });
      }
      const b = await readJson(req);
      const r = releases[idx];
      if (b.notes !== undefined) {
        r.notes = String(b.notes);
        r.notesHtml = md(b.notes);
      }
      if (b.mandatory !== undefined) r.mandatory = !!b.mandatory;
      if (b.minVersion !== undefined) r.minVersion = b.minVersion || null;
      if (b.channel !== undefined) r.channel = b.channel;
      if (b.externalUrl !== undefined) {
        r.externalUrl = b.externalUrl || null;
        r.downloadUrl = r.externalUrl || `${PUBLIC_URL}/downloads/${r.id}/${encodeURIComponent(r.fileName)}`;
      }
      return send(res, 200, { release: r });
    }

    const mPublish = path.match(/^\/api\/admin\/releases\/([^/]+)\/publish$/);
    if (mPublish && method === 'POST') {
      if (!requireAdmin(req, res)) return undefined;
      const r = releases.find((x) => x.id === decodeURIComponent(mPublish[1]));
      if (!r) return fail(res, 404, 'Không tìm thấy bản phát hành này.');
      const b = await readJson(req);
      r.publishedAt = b.published ? now() : null;
      return send(res, 200, { release: r });
    }

    /* ── Quản trị: người dùng ── */
    if (path === '/api/admin/users' && method === 'GET') {
      if (!requireAdmin(req, res)) return undefined;
      const needle = String(q.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, Number(q.get('page') || 1));
      const limit = Math.max(1, Number(q.get('limit') || 20));
      let list = users;
      if (needle) {
        list = list.filter(
          (u) =>
            u.email.toLowerCase().includes(needle) || String(u.name || '').toLowerCase().includes(needle),
        );
      }
      const total = list.length;
      const items = list.slice((page - 1) * limit, page * limit).map((u) => {
        const kl = keys.get(u.id) || [];
        return {
          ...publicUser(u),
          disabled: !!u.disabled,
          keyVersion: kl.length ? kl[kl.length - 1].version : null,
          sessions: [...sessions.values()].filter((s) => s.userId === u.id && s.expiresAt > now()).length,
        };
      });
      return send(res, 200, { items, total, page, limit });
    }

    const mAdminUser = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (mAdminUser && method === 'PATCH') {
      if (!requireAdmin(req, res)) return undefined;
      const u = users.find((x) => x.id === decodeURIComponent(mAdminUser[1]));
      if (!u) return fail(res, 404, 'Không tìm thấy tài khoản này.');
      const b = await readJson(req);
      if (b.role !== undefined && b.role !== u.role) {
        const admins = users.filter((x) => x.role === 'admin' && !x.disabled);
        if (u.role === 'admin' && admins.length <= 1) {
          return fail(res, 400, 'Không thể hạ quyền quản trị viên cuối cùng.', 'LAST_ADMIN');
        }
        u.role = b.role;
      }
      if (b.disabled !== undefined) {
        const admins = users.filter((x) => x.role === 'admin' && !x.disabled);
        if (b.disabled && u.role === 'admin' && admins.length <= 1) {
          return fail(res, 400, 'Không thể khoá quản trị viên cuối cùng.', 'LAST_ADMIN');
        }
        u.disabled = !!b.disabled;
      }
      if (b.name !== undefined) u.name = String(b.name);
      return send(res, 200, { user: publicUser(u) });
    }

    const mResetCode = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-code$/);
    if (mResetCode && method === 'POST') {
      if (!requireAdmin(req, res)) return undefined;
      const u = users.find((x) => x.id === decodeURIComponent(mResetCode[1]));
      if (!u) return fail(res, 404, 'Không tìm thấy tài khoản này.');
      const code = crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 8);
      const expiresAt = now() + 30 * 60_000;
      resetCodes.set(u.email.toLowerCase(), { code, expiresAt, tries: 0 });
      return send(res, 200, { code, expiresAt });
    }

    /* ── Quản trị: số liệu + cấu hình ── */
    if (path === '/api/admin/stats' && method === 'GET') {
      if (!requireAdmin(req, res)) return undefined;
      return send(res, 200, {
        users: users.length,
        usersNew7d: users.filter((u) => u.createdAt > now() - 7 * day).length,
        releases: releases.length,
        downloadsTotal,
        downloads7d: 61,
        posts: posts.length,
        lastLogins: [...users]
          .filter((u) => u.lastLoginAt)
          .sort((a, b) => b.lastLoginAt - a.lastLoginAt)
          .slice(0, 5)
          .map(publicUser),
      });
    }

    if (path === '/api/admin/site' && method === 'GET') {
      if (!requireAdmin(req, res)) return undefined;
      return send(res, 200, site);
    }

    if (path === '/api/admin/site' && method === 'PUT') {
      if (!requireAdmin(req, res)) return undefined;
      const b = await readJson(req);
      site = {
        appName: b.appName ?? site.appName,
        tagline: b.tagline ?? site.tagline,
        hero: b.hero ?? site.hero,
        features: Array.isArray(b.features) ? b.features : site.features,
        contact: b.contact ?? site.contact,
      };
      return send(res, 200, site);
    }

    return fail(res, 404, `Không có route ${method} ${path} trong máy chủ mock.`, 'NOT_FOUND');
  } catch (err) {
    console.error('[mock] lỗi:', err);
    return fail(res, 500, 'Máy chủ mock gặp lỗi: ' + err.message);
  }
});

function stripContentMd(p) {
  const { contentMd, ...rest } = p;
  return rest;
}

/** Bản mới nhất theo nền tảng: ưu tiên đúng arch, không có thì lấy universal. */
function findLatest(platform, arch, channel = 'stable') {
  let items = releases.filter((r) => r.publishedAt && r.channel === channel);
  if (platform) items = items.filter((r) => r.platform === platform);
  if (arch) {
    const exact = items.filter((r) => r.arch === arch);
    items = exact.length ? exact : items.filter((r) => r.arch === 'universal');
  }
  items.sort((a, b) => cmpSemverDesc(a.version, b.version));
  return items[0] || null;
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Máy chủ MOCK Zalo Chat Assistant đang chạy: http://127.0.0.1:${PORT}`);
  console.log('  Tài khoản mẫu:');
  console.log('    admin@meddental.vn / 12345678   (quản trị viên)');
  console.log('    tuvan@meddental.vn / 12345678   (người dùng)');
  console.log('    nghiviec@meddental.vn           (đã bị khoá — để thử lỗi 403)');
  console.log('  Mã đăng ký hợp lệ khi đăng ký: MEDDENTAL (bỏ trống cũng được)');
  console.log('  Mã quên mật khẩu in ra ngay tại đây: [RESET-CODE] <email> → <mã>\n');
});
