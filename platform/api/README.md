# api — nền tảng web Zalo Chat Assistant

Express 4 + Mongoose 8 trên Node 20 (ESM, **không TypeScript**). Hiện thực đầy đủ
[`../API-CONTRACT.md`](../API-CONTRACT.md): xác thực & chuỗi mã hoá (mục 2), phát hành bản cập nhật (mục 3),
CMS + quản trị (mục 4).

Thay thế máy chủ cũ `server/` (Fastify + SQLite) **giữ nguyên cổng 4789 và giữ nguyên mọi hợp đồng route**,
nên ứng dụng desktop đang cài trên máy người dùng chạy tiếp mà không cần cập nhật.

---

## 1. Chạy để phát triển

```bash
# 1) MongoDB cho dev
docker run -d --name zca-mongo-dev -p 27018:27017 mongo:7

# 2) Cài phụ thuộc
cd platform/api && npm install

# 3) Chạy API
PORT=4791 \
MONGO_URL=mongodb://127.0.0.1:27018/zca_dev \
JWT_SECRET=dev \
ADMIN_EMAILS=admin@meddental.vn \
PUBLIC_URL=http://127.0.0.1:4791 \
RELEASES_DIR=./tmp/dev-data/releases \
UPLOADS_DIR=./tmp/dev-data/uploads \
npm run dev
```

Thiếu `JWT_SECRET` hoặc `MONGO_URL` là tiến trình **dừng ngay** kèm thông báo — cố tình, để lỗi cấu hình
lộ ra lúc khởi động chứ không phải lúc người dùng bấm đăng nhập.

## 2. Kiểm thử

Ba bộ, đều chạy thật (tự khởi động một API con rồi tắt, dùng **database riêng cho mỗi lần chạy** và xoá
sau khi xong). Chỉ cần MongoDB dev ở trên.

```bash
MONGO_URL=mongodb://127.0.0.1:27018/zca_dev JWT_SECRET=dev npm run smoke    # 60 ca — toàn bộ API
MONGO_URL=mongodb://127.0.0.1:27018/zca_dev JWT_SECRET=dev npm run compat   # 10 ca — app desktop THẬT
MONGO_URL=mongodb://127.0.0.1:27018/zca_dev JWT_SECRET=dev \
  node scripts/smoke-migrate.mjs                                            #  7 ca — migrate từ SQLite
```

- `scripts/smoke.mjs` — đăng ký/đăng nhập/refresh/phiên, chuỗi mã hoá, đổi & quên mật khẩu, CMS (kể cả
  chặn `<script>` trong markdown), phát hành + tải tệp thật 1 MB có đối chiếu sha256 và bộ đếm lượt tải,
  quản trị người dùng/thống kê/trang chủ, và giới hạn tần suất.
- `scripts/compat-appclient.mjs` — nạp **thẳng** `src/auth/client.js` của ứng dụng desktop (không giả lập)
  rồi đi hết `register → syncKeys → rotateKey → refresh → logout → login`. Đây là bằng chứng ứng dụng đang
  cài dùng được API mới mà không sửa dòng nào.
- `scripts/smoke-migrate.mjs` — dựng SQLite bằng **chính mã nguồn máy chủ cũ** rồi migrate, chứng minh
  mật khẩu cũ đăng nhập được, refresh token cũ vẫn refresh được, và chạy lại lần hai không đổi gì.

Thêm `--base http://host:cổng` để bắn vào một máy chủ đang chạy sẵn thay vì tự khởi động.
Cổng mặc định là 4791; **bị tiến trình khác chiếm thì bộ test tự nhảy sang cổng trống** và in cảnh báo.

## 3. Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `PORT` | `4789` | Giữ 4789 ở production để app đang cài không phải đổi địa chỉ |
| `MONGO_URL` | — | **Bắt buộc** |
| `JWT_SECRET` | — | **Bắt buộc**. Đổi ⇒ mọi access token hết hiệu lực ngay (refresh token vẫn dùng được) |
| `ACCESS_TTL_SEC` | `900` | Hạn access token |
| `REFRESH_TTL_DAYS` | `30` | Hạn refresh token |
| `RESET_TTL_MIN` | `30` | Hạn mã đặt lại mật khẩu |
| `ALLOW_REGISTRATION` | `true` | `false` = đóng tự đăng ký |
| `REGISTRATION_CODE` | — | Đặt để chỉ người có mã mới đăng ký được |
| `ADMIN_EMAILS` | — | Email (phân tách dấu phẩy) được nâng quyền admin khi đăng nhập / khi migrate |
| `PUBLIC_URL` | `http://localhost:4790` | Gốc dựng `downloadUrl` — phải là địa chỉ **người dùng gõ được** |
| `RELEASES_DIR` / `UPLOADS_DIR` | `/data/releases`, `/data/uploads` | Nằm trong volume `/data` |
| `CORS_ORIGINS` | `http://localhost:4790,http://localhost:5174` | App desktop không gửi `Origin` nên không cần khai |
| `SMTP_*` | — | Bỏ trống ⇒ mã đặt lại mật khẩu **ghi ra log** (`docker compose logs -f api`) |
| `APP_NAME` | `Zalo Chat Assistant` | |

## 4. Migrate từ máy chủ cũ

```bash
node scripts/migrate-from-sqlite.mjs --sqlite ./tmp/auth.db --mongo mongodb://127.0.0.1:27017/zca [--admin quan.tri@meddental.vn] [--dry-run]
```

Chép `users` (**giữ nguyên `id`**), `client_keys` (mọi phiên bản, đúng `source`), và `refresh_tokens`
**còn hiệu lực**. Idempotent — chạy bao nhiêu lần cũng ra một kết quả, nên cứ `--dry-run` thử trước.

Ba điều quyết định sự sống còn của đợt chuyển, đừng "tối ưu" đi:

1. **`user.id` phải giữ nguyên.** Ứng dụng dẫn xuất khoá mã hoá từ `user.id` (HKDF salt) — đổi id là người
   dùng mở ứng dụng lên thấy dữ liệu cũ không giải mã được.
2. **Refresh token chép sang với `token_hash` y nguyên** (SHA-256 **hex**, đúng như
   `server/src/security.js`). Nhờ vậy máy đang đăng nhập tự refresh sang máy chủ mới, không ai phải đăng
   nhập lại. Băm sai kiểu thì mọi thiết bị bị đá ra mà không có lỗi nào để lần ra.
3. **Chạy trên BẢN SAO** lấy bằng `docker cp`, đừng trỏ vào volume của container đang chạy (script mở
   SQLite ở chế độ `readonly`, nhưng container còn đang ghi thì ảnh chụp không nhất quán).

## 5. Cutover từ `server/` sang api mới

`server/` **giữ nguyên, không sửa**, cho tới khi bước 6 xác nhận xong — hỏng đâu là quay đầu được ngay.

```bash
# 1) Dừng máy chủ cũ (KHÔNG xoá container, KHÔNG xoá volume zalo-auth-data)
docker stop zalo-auth

# 2) Lấy bản sao SQLite ra ngoài
mkdir -p platform/api/tmp
docker cp zalo-auth:/data/auth.db platform/api/tmp/auth.db

# 3) Dựng Mongo + api mới (api tạm chưa chiếm 4789 — sửa API_PORT trong .env nếu muốn thử trước)
cd platform
cp .env.example .env      # điền JWT_SECRET (openssl rand -base64 48), ADMIN_EMAILS, PUBLIC_URL
docker compose up -d mongo api

# 4) Nhập dữ liệu (chạy từ máy quản trị — cần devDependencies để có better-sqlite3)
cd api && npm install
node scripts/migrate-from-sqlite.mjs \
  --sqlite ./tmp/auth.db \
  --mongo mongodb://127.0.0.1:27017/zca \
  --admin quan.tri@meddental.vn

# 5) api mới chiếm cổng 4789 (giữ nguyên địa chỉ máy chủ trong ứng dụng)
cd .. && docker compose up -d api

# 6) Xác nhận
curl -s http://127.0.0.1:4789/health          # users phải khớp số tài khoản hệ cũ
```

**Ứng dụng đang cài không cần làm gì.** Access token cũ hết hạn sau tối đa 15 phút, ứng dụng tự gọi
`/api/auth/refresh` bằng refresh token đã được chép sang — người dùng không thấy màn đăng nhập.
`JWT_SECRET` mới không ảnh hưởng: access token cũ chỉ bị coi là hết hạn, mà refresh token thì không ký
bằng JWT.

Quay đầu: `docker compose stop api && docker start zalo-auth`. SQLite cũ chưa bị đụng tới.

Xong xuôi và chạy ổn vài ngày thì mới xoá container cũ. **Đừng xoá volume `zalo-auth-data`** — đó là bản
sao lưu duy nhất của dữ liệu trước khi chuyển.

## 6. Bố cục

```
src/
  index.js            khởi động: cấu hình → thư mục → MongoDB → mở cổng (đúng thứ tự này)
  app.js              dựng Express: helmet, CORS, log, gắn route, 404 + xử lý lỗi
  config.js           đọc env, fail-fast khi thiếu JWT_SECRET / MONGO_URL
  db.js               kết nối Mongoose
  security.js         scrypt / JWT HS256 / sha256 — ĐỒNG BỘ TỪNG BYTE với server/src/security.js
  models/             User, RefreshToken, ResetCode, ClientKey, Release, Post, SiteSetting, DownloadEvent
  middleware/         auth (Bearer + vai trò), rateLimit, logger, errors
  services/           tokens, keys, mailer, markdown (marked + sanitize-html), semver, slug, releases
  routes/             auth, me, keys, releases, downloads, posts, site + admin/{releases,posts,uploads,users,stats,site}
scripts/
  migrate-from-sqlite.mjs   nhập dữ liệu từ máy chủ cũ
  smoke.mjs  compat-appclient.mjs  smoke-migrate.mjs   kiểm thử
```

## 7. Chỗ hiện thực KHÁC hợp đồng (có chủ ý — đọc trước khi "sửa cho khớp")

| Chỗ | Hợp đồng ghi | Hiện thực | Lý do |
|---|---|---|---|
| Định dạng scrypt | `N=16384`, `keylen 64` | `N=32768`, `keylen 32` | Dữ liệu thật trong SQLite là `scrypt$32768$8$1$…`, đúng `server/src/security.js`. Theo hợp đồng thì **người dùng cũ không đăng nhập được**. (Việc kiểm mật khẩu tự đọc N/r/p từ chuỗi nên vẫn nhận cả hai.) |
| Băm refresh token | "SHA-256 base64url" | SHA-256 **hex** | `server/src/routes.js` băm hex; đổi sang base64url là mọi thiết bị đang đăng nhập bị đá ra sau cutover. |
| `POST /api/me/change-password` sai mật khẩu | 401 | **400** | Máy chủ cũ trả 400. Quan trọng hơn: `AuthClient.authed()` của ứng dụng bắt 401 để tự refresh **rồi gọi lại** — trả 401 ở đây làm app xoay vòng token vô ích. Web đọc `body.error` nên không bị ảnh hưởng. |

Ngoài ra là phần **thêm vào**, không phá hợp đồng: `user.role` trong mọi phản hồi; JWT mang thêm `role`,
`kv`, `rtid`, `typ` (bội của payload cũ); `/health` thêm `version`; `forgot-password` giữ thêm trường
`message` của máy chủ cũ; `logout` vẫn nhận `all: true`; collection `download_events` để tính `downloads7d`.

## 8. Việc còn nợ

- **`platform/web` chưa có `Dockerfile`** (nhóm web đang làm) ⇒ `docker compose up -d` cả stack sẽ hỏng ở
  service `web`. Trước khi họ xong, chạy `docker compose up -d mongo api`.
- **Chưa có backup Mongo tự động.** Trước khi chạy production cần một `mongodump` theo lịch — `/data`
  (tệp cài đặt + ảnh CMS) cũng phải nằm trong diện sao lưu.
- **Giới hạn tần suất nằm trong bộ nhớ tiến trình**: chạy nhiều bản api thì mỗi bản đếm riêng. Một bản như
  hiện nay thì đủ; scale ngang thì phải chuyển sang Redis.
- **Chưa có xoay vòng log** và chưa có chỉ số dạng Prometheus.
