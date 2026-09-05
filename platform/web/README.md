# platform/web — Website + Admin CMS

Giao diện web của nền tảng **Zalo Chat Assistant**: trang giới thiệu/tải về cho tư vấn viên và khu quản
trị nội dung cho admin.

- **React 19 + Vite 6 + react-router-dom 7**, **JavaScript thuần** (không TypeScript).
- **CSS thuần** (`src/styles.css`), biến màu lấy đúng từ giao diện ứng dụng (`src/ui/index.html` ở gốc
  repo): `--primary: #0a66ff`, nền `#f5f7fb`, thẻ bo `16px`, nút cao `44px`, pill bo tròn.
  **Không dùng MUI/Tailwind.**
- Phụ thuộc ngoài duy nhất trong mã nguồn: `marked` (xem trước Markdown ở khu quản trị).
- Mọi chữ trên giao diện và mọi thông báo lỗi đều **tiếng Việt có dấu**.

Hợp đồng API: [`../API-CONTRACT.md`](../API-CONTRACT.md). Web **không** tự định nghĩa route API nào
ngoài hợp đồng đó.

---

## Chạy dev (kèm máy chủ mock, không cần nhóm api)

```bash
cd platform/web
npm install

# Cách 1 — một lệnh cho cả hai tiến trình
npm run dev:all          # mock :4791 + vite :5174

# Cách 2 — hai cửa sổ terminal
npm run mock             # cửa sổ 1: máy chủ mock, cổng 4791
npm run dev              # cửa sổ 2: Vite, cổng 5174
```

Mở **http://localhost:5174**.

Tài khoản mẫu của máy chủ mock:

| Email | Mật khẩu | Vai trò |
|---|---|---|
| `admin@meddental.vn` | `12345678` | admin (vào được `/admin`) |
| `tuvan@meddental.vn` | `12345678` | user (vào `/admin` sẽ ra trang 403) |
| `nghiviec@meddental.vn` | `12345678` | user **đã bị khoá** (đăng nhập trả 403) |

Ghi chú về mock:

- Mã đăng ký hợp lệ khi đăng ký: `MEDDENTAL` (bỏ trống cũng được).
- Quên mật khẩu trả `delivery: "server-log"`; **mã 8 ký tự in ra ngay trên terminal của mock**:
  `[RESET-CODE] <email> → <mã>`.
- Dữ liệu nằm trong bộ nhớ — tắt mock là mất, khởi động lại có bộ dữ liệu mẫu sạch.
- Mock thêm độ trễ 120 ms mỗi request để nhìn thấy trạng thái "đang tải" trên giao diện.
- Tệp tải về ở `/downloads/...` là tệp văn bản giả; ảnh ở `/uploads/...` là ảnh SVG chỗ dành sẵn.

### Cổng

| Tiến trình | Cổng |
|---|---|
| Vite dev/preview | **5174** |
| Máy chủ mock | **4791** |
| api thật (Docker) | 4789 |
| web sau nginx (Docker) | 4790 → :80 |

Cổng 4791 bị chiếm (ví dụ nhóm api đang dùng) thì chạy mock ở cổng khác và báo cho Vite biết:

```bash
PORT=4795 npm run mock
ZCA_API_PORT=4795 npm run dev
```

### Trỏ thẳng vào api thật thay vì mock

```bash
ZCA_API_PORT=4789 npm run dev     # cần api chạy sẵn ở 127.0.0.1:4789
```

Proxy của Vite chuyển `/api`, `/downloads`, `/uploads` sang `http://127.0.0.1:<ZCA_API_PORT>`
(mặc định `4791`). Nhờ vậy trình duyệt luôn gọi **cùng origin** — không cần CORS lúc dev.

---

## Build

```bash
npm run build      # ra thư mục dist/ (build sạch, không cảnh báo)
npm run preview    # xem thử bản build ở :5174, vẫn proxy sang mock/api
```

## Docker

```
Dockerfile   node:20-alpine (npm ci + vite build) → nginx:1.27-alpine phục vụ dist/
nginx.conf   SPA fallback + proxy /api/ /downloads/ /uploads/ → http://api:4789
```

Điểm đáng lưu ý trong `nginx.conf`:

- `client_max_body_size 600m` + timeout 600 giây — đủ cho admin tải bản cài `.dmg`/`.exe` lên.
- Upstream đặt trong **biến** (`set $api_upstream …` + `resolver 127.0.0.11`) để nginx chỉ phân giải
  tên `api` khi có request. Viết `proxy_pass http://api:4789` trực tiếp thì api chưa lên là nginx
  **chết ngay lúc khởi động** với `host not found in upstream`.
- MIME cho `.mjs` khai bằng **khối `location ~* \.mjs$` riêng** (`default_type application/javascript`).
  Bảng `mime.types` của nginx không có đuôi `.mjs` ⇒ mặc định `application/octet-stream` ⇒ trình duyệt
  từ chối nạp module script, lỗi đọc y hệt 404. **Không** chữa bằng directive `types { … }` ở mức
  server vì nó ghi đè cả bảng MIME kế thừa (mất luôn MIME của css/ảnh/font).

---

## Biến môi trường

Web **không nướng cấu hình vào bundle**: mọi lời gọi API đều là đường dẫn tương đối (`/api/...`) và do
nginx (production) hoặc proxy Vite (dev) chuyển tiếp. Nhờ vậy đổi tên miền không phải build lại.

| Biến | Nơi dùng | Mặc định | Ý nghĩa |
|---|---|---|---|
| `ZCA_API_PORT` | `vite.config.js`, chỉ lúc dev | `4791` | Cổng api/mock mà proxy trỏ tới |
| `PORT` | `scripts/mock-api.mjs` | `4791` | Cổng máy chủ mock |
| `PUBLIC_URL` | `scripts/mock-api.mjs` | `http://127.0.0.1:<PORT>` | Gốc dựng `downloadUrl` trong dữ liệu mẫu |

---

## Cấu trúc

```
platform/web/
  index.html              nạp /src/main.jsx
  vite.config.js          proxy /api /downloads /uploads (dev + preview)
  Dockerfile  nginx.conf  .dockerignore
  public/favicon.svg
  scripts/
    mock-api.mjs          máy chủ mock đúng hợp đồng (node:http, không phụ thuộc thêm)
    dev-all.mjs           chạy mock + vite trong một lệnh
  src/
    main.jsx              gắn các Provider: Toast → Confirm → Auth → Site → App
    App.jsx               bảng route + chốt chặn RequireAuth / RequireAdmin
    api.js                fetch + Bearer, tự refresh khi 401, upload có tiến trình (XHR)
    auth.jsx              AuthProvider + useAuth (user, role, login/register/logout)
    site.jsx              SiteProvider + useSite (GET /api/site dùng chung)
    styles.css            toàn bộ CSS
    lib/
      platform.js         nhận diện HĐH/chip máy người xem
      format.js           định dạng dung lượng, ngày, số, slug, so sánh semver
      useFetch.js         hook GET dùng chung (data/loading/error/reload)
    components/
      SiteLayout.jsx      header + footer trang công khai
      Modal.jsx           Modal + ConfirmProvider/useConfirm (thay window.confirm)
      Toast.jsx           ToastProvider/useToast
      ui.jsx              Loading, EmptyState, ErrorBox, Pagination, CopyButton,
                          PasswordInput, Prose (markdown), ProgressBar
      ReleaseCard.jsx     thẻ bản tải theo hệ điều hành
    pages/                Home, Download, Updates, Posts, PostDetail, Guide,
                          Login, Register, ForgotPassword, Account, NotFound, Forbidden
    admin/                AdminLayout, Dashboard, PostsAdmin, ReleasesAdmin,
                          UsersAdmin, SiteAdmin
```

### Bảng trang

| Đường dẫn | Trang | Ghi chú |
|---|---|---|
| `/` | Trang chủ | hero + tính năng từ `GET /api/site`, bản mới nhất theo HĐH, bài ghim |
| `/tai-ve` | Tải về | tự nhận diện máy → `GET /api/releases/latest`; SHA-256, dung lượng, ghi chú cài đặt |
| `/cap-nhat` | Lịch sử phiên bản | `GET /api/releases`, gộp theo số phiên bản, đổi kênh ổn định/thử nghiệm |
| `/bai-viet`, `/bai-viet/:slug` | Bài viết | phân trang, lọc theo thẻ |
| `/huong-dan`, `/huong-dan/:slug` | Hướng dẫn | bài `kind=page` |
| `/dang-nhap`, `/dang-ky`, `/quen-mat-khau` | Xác thực | quên mật khẩu 2 bước (xin mã → đặt lại) |
| `/tai-khoan` | Tài khoản | hồ sơ, đổi mật khẩu, phiên đăng nhập, chuỗi mã hoá + nút Đổi chuỗi |
| `/403`, `/404`, `*` | Trang lỗi | đều có nút **Về trang chủ** |
| `/admin` | Tổng quan | `GET /api/admin/stats` |
| `/admin/bai-viet` | Bài viết | soạn Markdown, xem trước tại chỗ, tải ảnh bìa, nháp/xuất bản, ghim |
| `/admin/phien-ban` | Phiên bản | kéo-thả tệp cài (có tiến trình), hoặc liên kết ngoài; xuất bản/gỡ/xoá |
| `/admin/nguoi-dung` | Người dùng | tìm, phân trang, đổi vai trò, khoá/mở, tạo mã đặt lại mật khẩu |
| `/admin/trang-chu` | Trang chủ | sửa hero, khẩu hiệu, khối tính năng, liên hệ |

---

## Quy ước khi sửa mã nguồn

1. **Không dùng `window.confirm`/`window.alert`** ở khu quản trị — dùng `useConfirm()` của
   `components/Modal.jsx` (hộp thoại có cảnh báo hậu quả) và `useToast()` để báo kết quả.
2. **Mọi lỗi API hiện đúng câu tiếng Việt máy chủ trả về** ở trường `error`. `api.js` đã bọc sẵn thành
   `ApiError.message`; giao diện chỉ việc đưa vào `<ErrorBox error={err} />`.
3. **Access token chỉ nằm trong bộ nhớ**, refresh token nằm trong `localStorage`
   (`zca.refreshToken`). Gặp 401 thì `api.js` tự gọi `/api/auth/refresh` **đúng một lần** rồi lặp lại
   request.
   ⚠️ Refresh token **xoay vòng** — token cũ bị thu hồi ngay khi đổi. Vì vậy mọi lời gọi làm mới
   phiên phải đi qua `ensureAccessToken()` (đã gộp các lời gọi trùng nhau), **đừng gọi thẳng**
   `POST /api/auth/refresh` ở chỗ khác: hai lời gọi song song thì lời gọi sau dùng token đã bị thu
   hồi ⇒ 401 ⇒ người dùng bị đăng xuất oan. (React StrictMode chạy effect hai lần nên lỗi này xuất
   hiện ngay ở môi trường dev.)
4. **Đăng xuất ở trang cần quyền phải điều hướng TRƯỚC rồi mới xoá phiên** (xem `AdminLayout`,
   `SiteLayout`); làm ngược lại thì chốt chặn quyền kịp đá sang trang đăng nhập, người dùng không bao
   giờ thấy trang chủ.
5. **Nội dung bài viết hiển thị bằng `contentHtml` do máy chủ render + làm sạch.** `marked` ở phía
   trình duyệt **chỉ dùng để xem trước lúc soạn** — không dùng để hiển thị nội dung công khai.
6. Sửa hợp đồng API ⇒ sửa `../API-CONTRACT.md` trước, rồi cập nhật `scripts/mock-api.mjs` cho khớp,
   cuối cùng mới sửa giao diện.

---

## Đã tự kiểm thử

Chạy `npm run mock` + `npm run dev`, kiểm tra bằng trình duyệt (bản dev và bản `npm run build` +
`npm run preview`, console không có lỗi):

- Trang chủ, Tải về (nhận đúng *macOS · chip Apple*), Cập nhật (gộp theo phiên bản, đổi kênh), Bài
  viết + chi tiết, Hướng dẫn, 404.
- Đăng nhập → `/tai-khoan`: hồ sơ, danh sách phiên, **Đổi chuỗi mã hoá** (hộp thoại cảnh báo → toast
  báo phiên bản mới).
- Quên mật khẩu: bước 1 → bước 2 hiện hướng dẫn đọc mã trong log máy chủ.
- Khu quản trị: Tổng quan, Bài viết (tạo bài có dấu → slug không dấu tự sinh, xem trước Markdown,
  xuất bản, xoá có xác nhận), Phiên bản (chọn tệp `.dmg` → tự đoán phiên bản/nền tảng/chip, tải lên
  có tiến trình, xoá có xác nhận), Người dùng, Trang chủ (sửa và lưu).
- Tài khoản thường vào `/admin` → **trang 403** có nút Về trang chủ; đăng xuất → về trang chủ.

## Việc còn nợ

- Chưa có bộ kiểm thử tự động (chưa cài Playwright/Vitest theo yêu cầu không thêm phụ thuộc mới).
  Toàn bộ kiểm thử ở trên là thao tác tay trên trình duyệt.
- Chưa đối chiếu với **api thật** — mới chỉ chạy với `scripts/mock-api.mjs`. Khi api lên, chạy
  `ZCA_API_PORT=4789 npm run dev` và rà lại: định dạng `sessions` trong `GET /api/admin/users`, tên
  trường của `GET /api/admin/stats.lastLogins`, và mã lỗi khi đăng ký sai mã.
- `PUT /api/keys` (người dùng tự đặt chuỗi mã hoá) chưa có giao diện — hiện chỉ có nút *Đổi chuỗi*
  gọi `POST /api/keys/rotate`. Thêm khi có yêu cầu nghiệp vụ.
- Trang bài viết chưa có ô tìm kiếm toàn văn (hợp đồng chưa có tham số `q` cho `GET /api/posts`).
- Chưa làm đa ngôn ngữ — toàn bộ chuỗi tiếng Việt viết thẳng trong mã.
