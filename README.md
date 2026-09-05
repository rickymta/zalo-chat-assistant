# Zalo Chat Assistant

Ứng dụng macOS cho tư vấn viên MedDental: **đăng nhập tài khoản ứng dụng** (máy chủ xác thực riêng), **kết nối Zalo cá
nhân bằng mã QR**, **tự lưu mọi tin nhắn đến/đi vào máy ở dạng mã hoá**, **duy trì một thư mục làm việc** để
**Claude Cowork** tổng hợp hội thoại và đề xuất câu trả lời, **hiện gợi ý của Claude ngay cạnh hội thoại** và cho
**trả lời trực tiếp** từ ứng dụng (mỗi tin gửi là một lần người dùng bấm Gửi — không gửi tự động/hàng loạt; tin gửi đi
cũng được lưu mã hoá). Ứng dụng không đánh dấu đã xem.

Dùng cùng thư viện `zca-js` và cùng cách đăng nhập với kênh Zalo cá nhân trong CRM (`backend/services/zalo-personal-bridge`
của repo `mdt-re-construct-research`), nhưng chạy độc lập trên máy cá nhân.

## Kiến trúc tổng thể

```
┌─ Máy chủ xác thực (server/, Node + SQLite, Docker) ───────────────────────────────┐
│ đăng ký · đăng nhập (JWT + refresh token xoay vòng) · quên mật khẩu (mã 8 ký tự)   │
│ cấp / lưu / đổi CHUỖI MÃ HOÁ theo phiên bản cho từng tài khoản. KHÔNG nhận tin nhắn │
└────────────────────────────────────────────────────────────────────────────────────┘
                 ▲ HTTPS (chỉ bridge gọi)
┌─ Máy Mac của tư vấn viên: Zalo Chat Assistant.app ────────────────────────────────┐
│ electron/main.js  cửa sổ + chạy nền + tự mở khi bật máy                            │
│ src/app.js        BRIDGE Node cục bộ (127.0.0.1:3789): giữ phiên máy chủ trong      │
│                   data/auth.json ⇒ tắt máy mở lại KHÔNG phải đăng nhập lại           │
│ src/zalo/*        zca-js: QR, listener, ghi tin (chỉ khi đã mở khoá)                │
│ src/db.js         SQLite: nội dung mã hoá AES-256-GCM từng trường, khoá theo phiên bản│
│ src/workspace.js  ~/Documents/Zalo Chat Assistant/ = thư mục Claude Cowork trỏ vào  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Dành cho người dùng

1. **Cài**: mở `Zalo Chat Assistant-<phiên bản>-arm64.dmg`, kéo vào **Applications**. Lần đầu macOS có thể hỏi — **chuột
   phải → Mở**. Nếu vẫn bị chặn: `xattr -dr com.apple.quarantine "/Applications/Zalo Chat Assistant.app"`.
2. **Đăng ký / đăng nhập** tài khoản ứng dụng (email + mật khẩu; có mã đăng ký nếu công ty yêu cầu). Quên mật khẩu → nhận mã
   8 ký tự qua email (hoặc quản trị viên đọc mã trong log máy chủ) → đặt mật khẩu mới. Đăng nhập một lần; các lần mở sau
   ứng dụng tự mở khoá.
3. **Kết nối Zalo**: ở thanh trên màn Hội thoại bấm *Đăng nhập Zalo (QR)* → Zalo trên điện thoại → biểu tượng QR → quét →
   Đồng ý. Để ứng dụng chạy (đóng cửa sổ vẫn chạy nền; thoát hẳn ⌘Q). Bật *Cài đặt → Tự mở ứng dụng khi bật máy*.
4. **Claude Cowork**: trỏ Cowork vào `~/Documents/Zalo Chat Assistant/` **một lần**. Mỗi khi muốn Claude làm việc, bấm
   **📁 Cập nhật dữ liệu cho Claude** (chọn kiểu: khách đang chờ trả lời / hôm nay / 7 ngày / nhóm / tất cả), rồi nhắn
   Cowork: *"Đọc `huong-dan/00-chi-dan-cho-claude.md` rồi tổng hợp tất cả hội thoại trong du-lieu/ và đề xuất phản hồi cho từng hội thoại."*
   Claude ghi kết quả vào `ket-qua/` (bản `.md` cho người đọc **và** `de-xuat.json` cho máy đọc). Ứng dụng theo dõi thư mục
   này: hội thoại có gợi ý hiện nhãn **💡 Có gợi ý**; mở hội thoại thấy thẻ gợi ý (ưu tiên, tóm tắt, câu trả lời, ghi chú)
   → bấm **Dùng gợi ý này** để điền vào ô soạn → sửa → **Gửi**. Gợi ý cũ hơn tin mới nhất được cảnh báo "có tin mới sau gợi ý".

Thư mục làm việc (ứng dụng tự tạo và cập nhật):

| Đường dẫn | Ai ghi | Nội dung |
|---|---|---|
| `CLAUDE.md`, `huong-dan/` | Ứng dụng (mỗi lần mở) | Chỉ dẫn cho Claude + tham chiếu MedDental |
| `du-lieu/` | Ứng dụng (nút Cập nhật) | Hội thoại đã **giải mã**: `00-INDEX.md`, `hoi-thoai/*.md`, CSV, Excel (tuỳ chọn) — **ghi đè** mỗi lần |
| `ket-qua/` | Claude | Tổng hợp + đề xuất |

### Những điều phải biết

- **Hội thoại 1-1 chỉ có tin từ lúc kết nối Zalo trở đi** (cộng tin Zalo gửi bù khi nối lại). Zalo không có API lịch sử 1-1.
- **Nhóm chat**: ứng dụng hỏi lịch sử gần đây của mọi nhóm qua endpoint mới của Zalo Web (`group_cloud_message/api/cm/getrecentv2`
  — endpoint cũ trong zca-js 2.1.2 đã bị Zalo bỏ, trả 404). Thử 05/09/2026: Zalo trả `isFiltered=1`, 0 tin cho cả 65 nhóm ⇒
  **đừng trông vào lịch sử nhóm**; tin nhóm được lưu đầy đủ từ lúc kết nối. Tự thử lại 24 giờ/lần.
- **Không mở Zalo Web (chat.zalo.me) trên trình duyệt** cùng lúc — sẽ làm mất kết nối; Zalo trên điện thoại dùng bình thường.
- **Tài khoản Zalo có thể bị khoá** vì giao thức không chính thức. Dùng số công ty cấp.
- **Mã hoá**: tin nhắn, tên, số điện thoại, xem trước, đính kèm trong SQLite được mã hoá bằng khoá dẫn xuất từ chuỗi máy chủ
  cấp (HKDF theo user id + AES-256-GCM). Khoá/thời gian/cờ (thread id, mốc giờ, loại) giữ nguyên để lọc và sắp. Máy chủ
  **không bao giờ nhận tin**. `du-lieu/` trong thư mục Claude là bản **giải mã** — xoá bằng *Cài đặt → Xoá dữ liệu đã chuẩn bị*.
- **Đổi chuỗi mã hoá** (*Cài đặt → Bảo mật*): máy chủ cấp phiên bản mới, ứng dụng mã hoá lại toàn bộ theo lô (tiếp tục được
  nếu ngắt giữa chừng; mỗi giá trị mang `enc:v<phiên bản>:`). Máy khác cùng tài khoản tự nhận chuỗi mới khi mở.
- **Đăng xuất ứng dụng** xoá `data/auth.json` (token + chuỗi); dữ liệu vẫn nằm trên máy dạng mã hoá, đăng nhập lại cùng tài
  khoản là đọc được. Ai có `data/auth.json` hoặc `data/sessions/` là dùng được — không chia sẻ thư mục dữ liệu.

## Máy chủ xác thực (`server/`)

```bash
cd server
cp .env.example .env          # đặt JWT_SECRET (openssl rand -base64 48), tuỳ chọn REGISTRATION_CODE, SMTP_*
docker compose up -d --build
curl http://127.0.0.1:4789/health
docker compose logs -f zalo-auth   # mã quên mật khẩu hiện ở đây khi chưa cấu hình SMTP: [RESET-CODE] email → mã
```

| Endpoint | Ý nghĩa |
|---|---|
| `POST /api/auth/register` `{email,password,name,registrationCode?}` | Tạo tài khoản, cấp chuỗi mã hoá phiên bản 1 |
| `POST /api/auth/login` · `/refresh` · `/logout` | Access token 15 phút + refresh token 30 ngày (xoay vòng, thu hồi token cũ) |
| `POST /api/auth/forgot-password` · `/reset-password` `{email,code,newPassword}` | Mã 8 ký tự, hiệu lực 30 phút, tối đa 5 lần thử |
| `GET /api/me` · `POST /api/me/change-password` | Hồ sơ, đổi mật khẩu |
| `GET /api/keys` | Chuỗi hiện tại + mọi phiên bản cũ (để máy bỏ lỡ lần đổi vẫn giải mã được) |
| `POST /api/keys/rotate` · `PUT /api/keys {key}` | Đổi chuỗi (máy chủ sinh) / lưu chuỗi do client chọn (≥ 32 ký tự) |

Mật khẩu băm scrypt; JWT HS256 (`JWT_SECRET`); giới hạn tần suất theo IP; dữ liệu ở volume `zalo-auth-data`
(`/data/auth.db`). Triển khai thật: đặt sau reverse proxy HTTPS, đổi địa chỉ máy chủ trong màn đăng nhập của ứng dụng
(*Nâng cao*) hoặc đặt mặc định bằng `ZCA_SERVER_URL` khi đóng gói.

## Dành cho người kỹ thuật

### Chạy bằng Node (máy dev, Node ≥ 20)

```bash
npm install
npm start                          # http://127.0.0.1:3789 — thư mục Claude = ./cowork
ZCA_SERVER_URL=http://127.0.0.1:4789 npm start
npm run seed:demo                  # cần data/auth.json (đăng nhập trong ứng dụng trước) — gieo dữ liệu mẫu đã mã hoá
npm run export -- --preset week    # cập nhật du-lieu/ bằng dòng lệnh (cần data/auth.json)
```

Biến môi trường: `ZCA_DATA_DIR` (mặc định `./data`), `ZCA_WORKSPACE_DIR` (mặc định `./cowork`; bản .app dùng
`~/Documents/Zalo Chat Assistant`), `ZCA_SERVER_URL` (mặc định `http://127.0.0.1:4789`), `PORT` (3789), `OPEN_BROWSER=false`.

### Đóng gói bản Electron

```bash
npm run app        # chạy cửa sổ Electron (tự dựng lại better-sqlite3 cho Electron)
npm run dist       # dist/Zalo Chat Assistant-<ver>-arm64.dmg
npm run dist:all   # thêm bản x64
```

`better-sqlite3` là module native, bản build cho Node và Electron **không dùng chung** — `scripts/ensure-native.js` tự dựng
lại đúng runtime trước mỗi lệnh. Ký/công chứng: cần Apple Developer ID (`CSC_LINK`, `APPLE_ID`…, thêm `"notarize": true`).

### Cấu trúc mã nguồn

```
server/                 Máy chủ xác thực (Fastify + better-sqlite3 + nodemailer), Dockerfile, docker-compose.yml
electron/main.js        Vỏ ứng dụng macOS
src/app.js              Lõi: mở SQLite → bridge HTTP → mở khoá theo data/auth.json → khôi phục Zalo → mã hoá lại nền
src/auth/client.js      Client máy chủ xác thực: giữ refresh token + chuỗi mã hoá, tự refresh, đồng bộ phiên bản khoá
src/crypto/cipher.js    AES-256-GCM từng trường, khoá dẫn xuất HKDF, giá trị mang phiên bản `enc:v<n>:`
src/db.js               SQLite: mã hoá khi ghi / giải mã khi đọc, tìm kiếm bằng JS, mã hoá lại theo lô
src/zalo/*              manager (QR, listener, nhập lịch sử nhóm), normalize, profiles, groupHistory (endpoint mới)
src/workspace.js        Thư mục làm việc Claude: huong-dan/ (chép từ cowork/), du-lieu/ (ghi đè), ket-qua/
src/suggestions.js      Đọc gợi ý Claude trong ket-qua/ (de-xuat.json, fallback .md theo mẫu phiếu), gắn vào hội thoại, theo dõi thay đổi
src/export/*            markdown.js (mỗi hội thoại 1 file), excel.js (1 sheet/hội thoại)
src/server.js           API bridge: /api/auth/*, /api/security/*, /api/workspace/*, Zalo, hội thoại; gác 423 khi chưa mở khoá
src/ui/index.html       Giao diện: Đăng nhập/Đăng ký/Quên mật khẩu → Hội thoại · Cài đặt
cowork/                 = thư mục làm việc mẫu: CLAUDE.md, huong-dan/ (00–06 + tham-chieu-meddental/), du-lieu/, ket-qua/
```

### Cập nhật tài liệu cho Claude

Sửa trong `cowork/huong-dan/` (và `cowork/CLAUDE.md` = bản sao của 00). Ứng dụng chép sang thư mục làm việc mỗi lần mở; bản
`.app` phải đóng gói lại. Dữ liệu dịch vụ/bảng giá/bác sĩ (`cowork/huong-dan/tham-chieu-meddental/`) là bản sao từ repo
marketing: `bash scripts/sync-brand-docs.sh [đường-dẫn-repo]`.

### Khắc phục sự cố

| Hiện tượng | Xử lý |
|---|---|
| Màn đăng nhập báo *Không kết nối được máy chủ* | Máy chủ xác thực chưa chạy hoặc sai địa chỉ — kiểm tra `docker compose ps`, sửa ở *Nâng cao: địa chỉ máy chủ* |
| *Hết phiên — cần đăng nhập lại* trong Cài đặt | Refresh token quá 30 ngày hoặc bị thu hồi (đặt lại mật khẩu). Dữ liệu vẫn mở được bằng chuỗi đã lưu; đăng nhập lại để đồng bộ |
| Hội thoại hiện `[không giải mã được — thiếu khoá phiên bản n]` | Máy này thiếu phiên bản khoá cũ — đăng nhập lại để lấy đủ danh sách phiên bản từ máy chủ |
| *Cần đăng nhập lại* ở Zalo | Có phiên Zalo Web khác — đóng nó rồi *Quét mã QR* |
| Mã QR không hiện | Mất mạng, hoặc Zalo đổi giao thức → nâng `zca-js` rồi đóng gói lại |
| Không thấy `du-lieu/` cập nhật | Bấm *Cập nhật dữ liệu cho Claude*; kiểm tra *Nhật ký hoạt động* |
| `NODE_MODULE_VERSION` mismatch | Chạy đúng `npm start` / `npm run app` để `ensure-native` dựng lại module |
