# Hợp đồng API — nền tảng web Zalo Chat Assistant (MERN)

> Nguồn sự thật cho ba nhóm làm song song: **api/** (Express + MongoDB), **web/** (React + Vite), **ứng dụng desktop** (Electron,
> `src/`). Đổi hợp đồng ⇒ sửa file này trước. Tiếng Việt có dấu ở mọi thông báo lỗi và giao diện.

## 0. Bố cục thư mục

```
platform/
  API-CONTRACT.md          ← file này
  docker-compose.yml       ← mongo + api (4789) + web (4790 → nginx :80)
  .env.example
  api/                     ← Node 20 ESM, Express, Mongoose 8. KHÔNG TypeScript.
    package.json  Dockerfile  src/{index,config,db,models/*,routes/*,middleware/*,services/*}.js
    scripts/migrate-from-sqlite.mjs   ← nhập users + client_keys (+ refresh_tokens) từ máy chủ cũ server/ (SQLite)
  web/                     ← React 19 + Vite + react-router-dom. KHÔNG TypeScript, không UI kit nặng (CSS thuần, theme giống app).
    package.json  Dockerfile  nginx.conf  index.html  src/...
```

Máy chủ cũ `server/` (Fastify + SQLite) GIỮ NGUYÊN cho tới khi cutover; không sửa. Ứng dụng desktop (`src/auth/client.js`) gọi các
route ở mục 2 — **không được đổi tên route, tên trường, mã lỗi**.

## 1. Quy ước chung

- Base URL API: `http://<host>:4789` (giữ cổng cũ để app đang cài không phải đổi). Web: `http://<host>:4790`, nginx proxy
  `/api/*`, `/downloads/*`, `/uploads/*` sang api.
- JSON UTF-8. Lỗi: HTTP 4xx/5xx + body `{ "error": "<câu tiếng Việt cho người dùng>", "code"?: "<MA_LOI>" , ...trường phụ }`.
- Xác thực: `Authorization: Bearer <accessToken>` (JWT HS256, payload `{ sub, email, role, iat, exp }`, hạn `ACCESS_TTL_SEC`
  mặc định 900). Refresh token là chuỗi ngẫu nhiên 32 byte base64url, lưu **băm SHA-256 dạng hex** trong DB (đúng cách máy chủ cũ — để token đã
  cấp vẫn dùng được sau khi migrate), xoay vòng mỗi lần refresh.
- Vai trò: `user` | `admin`. Route `/api/admin/*` yêu cầu `admin` (403 nếu không). Admin đầu tiên: email trong biến môi trường
  `ADMIN_EMAILS` (phân tách dấu phẩy) được nâng quyền khi đăng nhập hoặc khi chạy migrate.
- Mật khẩu: giữ ĐÚNG định dạng máy chủ cũ để người dùng cũ đăng nhập được:
  `scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>` — dữ liệu thật dùng **N=32768, r=8, p=1, keylen 32**, maxmem 64 MB (đọc tham số
  từ chính chuỗi băm khi kiểm; xem `server/src/security.js`). Đính chính 05/09/2026: bản đầu của hợp đồng ghi 16384/64 là sai.
- `user.id` là UUID **chuỗi**, phải GIỮ NGUYÊN giá trị cũ khi migrate — ứng dụng dẫn xuất khoá mã hoá từ `user.id` (HKDF salt),
  đổi id là mất khả năng đọc dữ liệu đã mã hoá trên máy người dùng.
- Đối tượng `user` trả về: `{ id, email, name, role, createdAt, lastLoginAt }` (epoch ms).
- Giới hạn tần suất: `/api/auth/login|register|forgot-password|reset-password` 10 lượt/phút/IP → 429 `{ error }`.
- Thời gian: epoch ms trong JSON, trừ `accessExpiresIn` (giây).

## 2. Xác thực & chuỗi mã hoá (ứng dụng desktop đang dùng — bất biến)

| Route | Body | Trả về |
|---|---|---|
| `GET /health` | — | `{ status: "ok", users, smtp: bool, version }` |
| `POST /api/auth/register` | `{ email, password, name?, registrationCode?, device? }` | `{ user, accessToken, accessExpiresIn, refreshToken, encryptionKey: { version, key } }` — 403 nếu tắt đăng ký hoặc mã đăng ký sai, 409 email đã có, 400 mật khẩu < 8 |
| `POST /api/auth/login` | `{ email, password, device? }` | như register, `encryptionKey` = khoá hiện tại hoặc `null`; 401 sai; 403 tài khoản bị khoá (`disabled`) |
| `POST /api/auth/refresh` | `{ refreshToken }` | như login (refresh token MỚI, token cũ đánh dấu `replacedBy`); 401 nếu hết hạn/thu hồi |
| `POST /api/auth/logout` | `{ refreshToken }` | `{ ok: true }` (luôn 200) |
| `POST /api/auth/forgot-password` | `{ email }` | `{ ok: true, delivery: "email" \| "server-log" }` — luôn 200 kể cả email không tồn tại; mã 8 ký tự A-Z0-9 hạn `RESET_TTL_MIN`, tối đa 5 lần thử |
| `POST /api/auth/reset-password` | `{ email, code, newPassword }` | `{ ok: true }`; thu hồi mọi refresh token; 400 mã sai/hết hạn |
| `GET /api/me` 🔒 | — | `{ user, keyVersion }` |
| `POST /api/me/change-password` 🔒 | `{ currentPassword, newPassword }` | `{ ok: true }`; **400** mật khẩu hiện tại sai (không dùng 401 vì `AuthClient.authed()` coi 401 là hết phiên và tự refresh rồi gọi lại) |
| `GET /api/me/sessions` 🔒 (mới) | — | `{ items: [{ id, device, createdAt, expiresAt, current: bool }] }` (refresh token còn hiệu lực) |
| `DELETE /api/me/sessions/:id` 🔒 (mới) | — | `{ ok: true }` |
| `GET /api/keys` 🔒 | — | `{ current: { version, key }, versions: [{ version, key, source, createdAt }] }` (mới nhất trước) |
| `POST /api/keys/rotate` 🔒 | — | `{ current: { version, key }, previous: { version, key } \| null }` — sinh khoá 32 byte base64url, version +1 |
| `PUT /api/keys` 🔒 | `{ key }` | như rotate, `source: "client"` |

Khoá client: chuỗi 32 byte `base64url` (như `newClientKey()` cũ). Mỗi user luôn có ≥ 1 khoá (tạo lúc đăng ký / migrate).

## 3. Phiên bản phần mềm & cập nhật

Model `Release`: `{ id, version (semver "1.2.0"), channel: "stable"|"beta", platform: "darwin"|"win32"|"linux",
arch: "arm64"|"x64"|"universal", fileName, fileSize, sha256, downloadUrl, externalUrl?, notes (markdown), notesHtml,
mandatory: bool, minVersion?: semver (bản cũ hơn bắt buộc cập nhật), publishedAt: ms|null (null = nháp), downloads, createdAt, createdBy }`.
`downloadUrl` = `externalUrl` nếu có, ngược lại `${PUBLIC_URL}/downloads/${id}/${fileName}`.

| Route | Trả về |
|---|---|
| `GET /api/releases?platform=&arch=&channel=stable&limit=50` | `{ items: [Release] }` — chỉ bản đã publish, mới nhất trước (so semver) |
| `GET /api/releases/latest?platform=darwin&arch=arm64&channel=stable` | `{ release: Release \| null }` — thiếu arch: ưu tiên đúng arch, rồi `universal` |
| `GET /api/releases/check?platform=&arch=&version=&channel=stable` | `{ updateAvailable: bool, current: "<version>", latest: Release \| null, mandatory: bool }` — `mandatory` = `latest.mandatory` hoặc `current < latest.minVersion` |
| `GET /downloads/:id/:fileName` (và `HEAD`) | Stream file, `Content-Disposition: attachment`, tăng `downloads` (GET) |
| `GET /api/site` | `{ appName, tagline, hero: { title, subtitle }, features: [{ icon, title, text }], contact: {...}, latest: { darwin-arm64: Release\|null, darwin-x64, win32-x64 } }` |

Admin 🔒👑:

| Route | Ghi chú |
|---|---|
| `GET /api/admin/releases` | mọi bản kể cả nháp |
| `POST /api/admin/releases` | `multipart/form-data`: `file` (tuỳ chọn nếu có `externalUrl`) + các trường; giới hạn 600 MB; lưu vào `RELEASES_DIR/<id>/<fileName>`, tính sha256 |
| `PUT /api/admin/releases/:id` | JSON đổi notes/mandatory/minVersion/channel/externalUrl |
| `POST /api/admin/releases/:id/publish` `{ published: bool }` | đặt/xoá `publishedAt` |
| `DELETE /api/admin/releases/:id` | xoá cả file |

## 4. Nội dung (CMS)

Model `Post`: `{ id, slug (unique), title, excerpt, contentMd, contentHtml (render server bằng marked + sanitize-html),
coverImageUrl?, tags: [string], kind: "post"|"page"|"changelog", pinned: bool, publishedAt: ms|null, authorId, createdAt, updatedAt }`.

| Route | Trả về |
|---|---|
| `GET /api/posts?kind=post&tag=&page=1&limit=12` | `{ items: [Post không kèm contentMd], total, page, limit }` (đã publish) |
| `GET /api/posts/:slug` | `{ post }` (đã publish; 404) |
| 🔒👑 `GET /api/admin/posts` | mọi bài kể cả nháp |
| 🔒👑 `POST /api/admin/posts` / `PUT /api/admin/posts/:id` / `DELETE /api/admin/posts/:id` | slug tự sinh từ title nếu bỏ trống (không dấu, gạch ngang) |
| 🔒👑 `POST /api/admin/uploads` | multipart `file` (ảnh ≤ 10 MB) → `{ url: "/uploads/<name>" }` |
| 🔒👑 `GET /api/admin/users?q=&page=&limit=` | `{ items: [user + disabled, keyVersion, sessions], total }` |
| 🔒👑 `PATCH /api/admin/users/:id` `{ name?, role?, disabled? }` | `{ user }` — không tự hạ quyền admin cuối cùng |
| 🔒👑 `POST /api/admin/users/:id/reset-code` | `{ code, expiresAt }` — admin đọc mã cho người dùng khi không có SMTP |
| 🔒👑 `GET /api/admin/stats` | `{ users, usersNew7d, releases, downloadsTotal, downloads7d, posts, lastLogins: [...] }` |
| 🔒👑 `GET/PUT /api/admin/site` | cấu hình trang chủ (nội dung của `GET /api/site` trừ `latest`) |

## 5. Biến môi trường api

`PORT=4789`, `MONGO_URL=mongodb://mongo:27017/zca`, `JWT_SECRET` (bắt buộc, fail-fast), `ACCESS_TTL_SEC=900`, `REFRESH_TTL_DAYS=30`,
`RESET_TTL_MIN=30`, `ALLOW_REGISTRATION=true`, `REGISTRATION_CODE=`, `ADMIN_EMAILS=`, `PUBLIC_URL=http://localhost:4790`
(gốc để dựng `downloadUrl`), `RELEASES_DIR=/data/releases`, `UPLOADS_DIR=/data/uploads`, `CORS_ORIGINS=http://localhost:4790,http://localhost:5174`,
`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, `APP_NAME=Zalo Chat Assistant`.

## 6. Ứng dụng desktop — kiểm tra cập nhật

- Máy chủ cập nhật = `serverUrl` của tài khoản (mặc định `http://127.0.0.1:4789`); có thể ghi đè bằng thiết lập `updateServerUrl`.
- Ứng dụng gọi `GET /api/releases/check?platform=<process.platform>&arch=<process.arch>&version=<app version>&channel=stable`
  lúc khởi động (sau 20 giây), rồi mỗi 6 giờ, và khi bấm **Kiểm tra cập nhật** trong Cài đặt.
- Có bản mới ⇒ thanh trên hiện "🆕 Có bản cập nhật <version>" với *Tải về* (mở `downloadUrl` bằng trình duyệt), *Xem thay đổi*
  (notes), *Bỏ qua bản này* (lưu `skippedVersion`; bản `mandatory` không cho bỏ qua). Không tự tải/cài (bản chưa ký).

## 7. Migrate từ máy chủ cũ

`node scripts/migrate-from-sqlite.mjs --sqlite <đường dẫn .sqlite> --mongo <MONGO_URL> [--admin email]`:
users (giữ `id`, `email`, `name`, `password_hash`, mốc thời gian, `disabled`), `client_keys` (user_id, version, key, source,
created_at), `refresh_tokens` còn hiệu lực (token_hash — cùng cách băm SHA-256 **hex** như `server/src/routes.js`, để app đang
đăng nhập không phải đăng nhập lại). Idempotent (upsert theo id / (userId, version) / tokenHash).
