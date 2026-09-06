# Zalo Chat Assistant

Ứng dụng macOS cho tư vấn viên MedDental: **đăng nhập tài khoản ứng dụng** (máy chủ xác thực riêng), **kết nối Zalo cá
nhân bằng mã QR**, **tự lưu mọi tin nhắn đến/đi vào máy ở dạng mã hoá**, **duy trì một thư mục làm việc** để
**Claude Cowork** tổng hợp hội thoại và đề xuất câu trả lời, **hiện gợi ý của Claude ngay cạnh hội thoại** và cho
**trả lời trực tiếp** từ ứng dụng. Giao diện theo bố cục Zalo (cột hội thoại + khung chat, Cài đặt là hộp thoại), đánh dấu
**chưa đọc/đã đọc** cục bộ như Zalo, hiển thị ảnh/GIF/sticker/video/tệp/cảm xúc, danh sách hội thoại cuộn ảo và tin nhắn
tải vô cực khi cuộn lên (mỗi tin gửi là một lần người dùng bấm Gửi — không gửi tự động/hàng loạt; tin gửi đi
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
4b. **Trong khung chat như Zalo**: rê chuột lên tin hiện 👍 (thả cảm xúc — 6 cảm xúc chuẩn, bấm pill của Bạn để bỏ) và ba nút
   Trả lời (trích dẫn), Chuyển tiếp (chọn nhiều hội thoại, chỉ tin văn bản — giới hạn của zca-js), Thêm (sao chép, xem ảnh).
   Ảnh/GIF/sticker mở hộp xem trong ứng dụng (← → chuyển ảnh, Esc đóng). Thanh công cụ trên ô soạn: **Sticker** (kho sticker
   Zalo, tìm theo từ khoá, có hàng Gần đây), **GIF** (tìm qua Tenor — cần điền *Cài đặt → Khoá Tenor API*, khoá miễn phí từ Google
   Cloud; không có khoá vẫn gửi GIF từ máy), **Ảnh** và **Tệp** (chọn từ máy, tối đa 10 tệp × 50 MB; bản sao lưu ở `data/sent/`
   để hiển thị lại), **Biểu cảm**. Mọi thao tác gửi đi
   (tin, trích dẫn, cảm xúc, chuyển tiếp) vẫn là do người dùng bấm, ứng dụng không tự gửi gì.
5. **📊 Báo cáo ngày** (nút ở thanh trên): một hộp thoại tổng hợp **toàn bộ hội thoại trong ngày** — số hội thoại/tin đến/tin
   đi/chưa trả lời/việc cần làm (đếm từ dữ liệu trên máy), phần *Tổng quan* và *Việc cần làm* do Claude viết, rồi từng hội
   thoại một thẻ: quan hệ (khách hàng/đồng nghiệp/đối tác/bạn bè/nhóm), tóm tắt, chủ đề, đã chốt, việc của Bạn, câu chưa trả
   lời, sắc thái. Bấm vào thẻ hoặc việc cần làm để mở đúng hội thoại; ◀ ▶ xem ngày trước/sau (45 ngày gần nhất); **Sao
   chép báo cáo** ra Markdown để dán vào Zalo/email; **Mở bản .md** mở file Claude đã viết. Ngày chưa được Claude tổng hợp
   vẫn hiện số liệu của ứng dụng (kèm tóm tắt lấy từ gợi ý gần nhất nếu có). Nguồn: `ket-qua/bao-cao/YYYY-MM-DD.json`.

**Tự động hoá hoàn toàn với lịch của Claude Cowork:** ứng dụng cập nhật `du-lieu/` **3 phút sau tin nhắn cuối** (và theo chu kỳ
*Cài đặt → Claude tổng hợp lại theo chu kỳ*, mặc định **30 phút**, đúng mốc :00/:30); trong Claude Cowork tạo một *scheduled task* chạy mỗi 5 phút (`*/5 7-22 * * *`) với nội dung: đọc `huong-dan/00`, bỏ qua nếu
`de-xuat.json` mới hơn `du-lieu/.trang-thai.json`, ngược lại **tổng hợp từng hội thoại một** (subagent Claude Sonnet, tuần
tự) và ghi `ket-qua/bao-cao/YYYY-MM-DD.json` + `.md` (báo cáo ngày), `ket-qua/de-xuat.json` (gợi ý) và
`YYYY-MM-DD-tong-hop.md`. Ứng dụng nhận file mới trong vài giây: gắn 💡 vào từng hội thoại và làm mới hộp thoại Báo cáo. Lịch chỉ chạy khi Claude
Cowork đang mở (đóng thì chạy bù ở lần mở sau). Mẫu prompt đầy đủ: `docs/cowork-scheduled-task.md`.

Thư mục làm việc (ứng dụng tự tạo và cập nhật):

| Đường dẫn | Ai ghi | Nội dung |
|---|---|---|
| `CLAUDE.md`, `huong-dan/` | Ứng dụng (mỗi lần mở) | Chỉ dẫn cho Claude + tham chiếu MedDental |
| `du-lieu/` | Ứng dụng (nút Cập nhật) | Hội thoại đã **giải mã**: `00-INDEX.md`, `hoi-thoai/*.md`, CSV, Excel (tuỳ chọn) — **ghi đè** mỗi lần |
| `ket-qua/` | Claude | `bao-cao/YYYY-MM-DD.json|.md` (báo cáo ngày — nguồn của nút 📊), `de-xuat.json` (gợi ý), `YYYY-MM-DD-tong-hop.md` |

### Kiểm tra bản cập nhật

Ứng dụng tự hỏi máy chủ xem có bản mới không: **20 giây sau khi mở** rồi **mỗi 6 giờ**. Có bản mới thì hiện một thanh ở đầu
màn hình — *🆕 Có bản cập nhật `<phiên bản>` (`<kích thước>`)* kèm ba nút: **Tải về và cài**, **Xem thay đổi** (danh sách thay
đổi, ngày phát hành, SHA-256), **Bỏ qua bản này** (không nhắc bản đó nữa; bản mới hơn vẫn được báo). Bản đánh dấu **bắt buộc**
hiện nền cảnh báo và **không có** nút bỏ qua.

**Cập nhật ngay trong ứng dụng (từ 0.0.2):** bấm *Tải về và cài* → ứng dụng tải bộ cài về `data/updates/` (thanh tiến độ trên
cùng), **đối chiếu SHA-256** với giá trị máy chủ công bố (không khớp thì bỏ tệp và báo lỗi, không cài) → hiện *✅ Đã tải xong ·
**Cài đặt và mở lại ứng dụng***. Bấm cài: ứng dụng đóng vài giây rồi tự mở lại ở bản mới; dữ liệu, phiên đăng nhập, chuỗi mã
hoá giữ nguyên.

| Hệ | Cách cài | Khi không tự cài được |
|---|---|---|
| macOS | Gắn tệp `.dmg` đã tải (ẩn), chép ứng dụng bên trong ra cạnh bản đang chạy bằng `ditto`, hoán chỗ, gỡ DMG, mở lại; bundle cũ xoá sau khi thoát. Tệp do chính ứng dụng tải nên không mang cờ quarantine — Gatekeeper không hỏi lại. | Thư mục chứa ứng dụng không ghi được (cài bởi tài khoản khác), đang chạy từ DMG/vị trí tạm ⇒ thanh báo chuyển sang *Tải bằng trình duyệt* để cài tay như lần đầu. |
| Windows | Chạy `Setup.exe /S --force-run` (bộ cài per-user, không cần quyền quản trị), ứng dụng tự thoát để bộ cài thay tệp rồi mở lại. | Bộ cài không chạy được ⇒ *Tải bằng trình duyệt*. |
| Chạy bằng Node (`npm start`) | Không tự cài — nút *Tải về* mở trình duyệt. | — |

Vì bản chưa ký (không có Apple Developer ID / chứng chỉ Windows) nên **không** dùng `autoUpdater` của Electron (macOS bắt buộc
chữ ký); cơ chế trên là bản thay thế có kiểm SHA-256. Có chữ ký sau này thì chuyển sang `electron-updater` và notarize để hết
cảnh báo "nhà phát triển không xác định" lúc cài lần đầu.

*Cài đặt → Phiên bản & cập nhật* cho biết phiên bản đang chạy, lần kiểm tra gần nhất và kết quả (đang dùng bản mới nhất / có
bản `x.y.z` / lỗi kết nối), kèm nút **Kiểm tra cập nhật** để hỏi ngay, công tắc **Tự kiểm tra cập nhật** và ô **Máy chủ cập
nhật** (để trống = dùng máy chủ tài khoản). Máy chủ không kết nối được thì lỗi chỉ hiện ở đó — ứng dụng vẫn chạy bình thường.

### Dùng thử trên máy khác không có Docker

Máy thử không cần máy chủ xác thực. Trên màn đăng nhập bấm **Bắt đầu dùng thử**: ứng dụng tự tạo danh tính và chuỗi mã hoá
ngay trên máy đó (`data/auth.json`, quyền 600). Mọi thứ khác — quét QR Zalo, lưu tin mã hoá, cột trợ lý, báo cáo, lịch
Cowork — hoạt động y như tài khoản thật. Giới hạn: chuỗi mã hoá không được sao lưu ở đâu khác nên **dữ liệu chỉ đọc được trên
máy đó**; *Đăng xuất* trong chế độ này **xoá** dữ liệu thử; chuyển sang tài khoản thật cũng phải xoá (ứng dụng hỏi xác nhận,
trả 409 kèm số tin/hội thoại nếu chưa đồng ý).

Các bước trên máy thử (macOS):

1. Chép file `.dmg` sang, kéo vào Applications, lần đầu **chuột phải → Mở** (hoặc `xattr -dr com.apple.quarantine`). Bản
   `arm64` cho Mac chip Apple; Mac Intel cần bản `x64` (`npm run dist:x64`).
2. Mở ứng dụng → **Bắt đầu dùng thử** → thanh trên **Đăng nhập Zalo (QR)**. Để *Cài đặt → Giữ máy không ngủ* và *Tự mở khi bật máy* bật.
3. Cài Claude desktop, trỏ Cowork vào `~/Documents/Zalo Chat Assistant`. Thêm vào `~/.claude/settings.json` của máy đó
   `permissions.allow` với đường dẫn tương ứng (xem `docs/cowork-scheduled-task.md`), rồi tạo scheduled task bằng mẫu prompt
   trong cùng file — đổi `/Users/<tên-máy>`.
4. Kết thúc thử: Cài đặt → Đăng xuất (xoá dữ liệu thử) hoặc đăng ký tài khoản thật.

**Windows (thử nghiệm):** dùng file `Zalo Chat Assistant-Setup-<phiên bản>-x64.exe` (dựng bằng `npm run dist:win` ngay trên macOS).
Bản chưa ký nên SmartScreen chặn lần đầu: bấm *More info → Run anyway*. Trình cài cho chọn thư mục, tạo shortcut. Sau đó
các bước giống macOS: **Bắt đầu dùng thử** (không cần Docker) → quét QR Zalo → Claude desktop cho Windows trỏ Cowork vào
`C:\Users\<tên>\Documents\Zalo Chat Assistant`. Dữ liệu ứng dụng ở `%APPDATA%\Zalo Chat Assistant\data`. Chống ngủ dùng
powerSaveBlocker của Electron (không có `caffeinate`); sao chép dùng clipboard Electron. Chưa kiểm tra trên máy Windows thật —
cần một lượt thử: cài, dùng thử, QR, nhận tin, cột trợ lý, báo cáo, cập nhật gói cho Claude, khoá/mở màn hình.

Cách khác không cần chế độ thử: giữ máy chủ Docker ở máy này, trên máy kia bấm *Máy chủ → Đổi* và nhập `http://<IP-máy-này>:4789`
(compose đã mở cổng trên mọi giao diện mạng; cần cùng mạng LAN, máy này thức và tường lửa cho phép). Cách này giữ đúng mô hình
tài khoản thật và đổi chuỗi mã hoá đồng bộ giữa các máy.

### Những điều phải biết

- **Hội thoại 1-1 chỉ có tin từ lúc kết nối Zalo trở đi** (cộng tin Zalo gửi bù khi nối lại). Zalo không có API lịch sử 1-1.
- **Nhóm chat**: ứng dụng hỏi lịch sử gần đây của mọi nhóm qua endpoint mới của Zalo Web (`group_cloud_message/api/cm/getrecentv2`
  — endpoint cũ trong zca-js 2.1.2 đã bị Zalo bỏ, trả 404). Thử 05/09/2026: Zalo trả `isFiltered=1`, 0 tin cho cả 65 nhóm ⇒
  **đừng trông vào lịch sử nhóm**; tin nhóm được lưu đầy đủ từ lúc kết nối. Tự thử lại 24 giờ/lần.
- **Không mở Zalo Web (chat.zalo.me) trên trình duyệt** cùng lúc — sẽ làm mất kết nối; Zalo trên điện thoại dùng bình thường.
- **Máy ngủ / khoá màn hình**: khoá màn hình KHÔNG ảnh hưởng (ứng dụng vẫn chạy, vẫn lưu tin). Máy **ngủ** thì Zalo mất kết
  nối; khi thức, ứng dụng tự nối lại, xin Zalo gửi bù tin bỏ lỡ (độ sâu do Zalo quyết) và ghi khoảng trống vào
  `du-lieu/.trang-thai.json` (+ cuối `README-DU-LIEU.md`) để Claude biết tin có thể thiếu; thanh trên hiện cảnh báo 💤. Mặc định
  *Cài đặt → Giữ máy không ngủ khi ứng dụng chạy* **bật** (giữ hệ thống thức, màn hình vẫn tắt/khoá được; gập MacBook vẫn
  ngủ theo hệ điều hành). Lịch Claude Cowork cũng chỉ chạy khi máy thức và Claude desktop đang mở — lượt lỡ chạy bù khi mở lại.
- **Tài khoản Zalo có thể bị khoá** vì giao thức không chính thức. Dùng số công ty cấp.
- **Mã hoá**: tin nhắn, tên, số điện thoại, xem trước, đính kèm trong SQLite được mã hoá bằng khoá dẫn xuất từ chuỗi máy chủ
  cấp (HKDF theo user id + AES-256-GCM). Khoá/thời gian/cờ (thread id, mốc giờ, loại) giữ nguyên để lọc và sắp. Máy chủ
  **không bao giờ nhận tin**. `du-lieu/` trong thư mục Claude là bản **giải mã** — xoá bằng *Cài đặt → Xoá dữ liệu đã chuẩn bị*.
- **Đổi chuỗi mã hoá** (*Cài đặt → Bảo mật*): máy chủ cấp phiên bản mới, ứng dụng mã hoá lại toàn bộ theo lô (tiếp tục được
  nếu ngắt giữa chừng; mỗi giá trị mang `enc:v<phiên bản>:`). Máy khác cùng tài khoản tự nhận chuỗi mới khi mở.
- **Đăng xuất ứng dụng** xoá `data/auth.json` (token + chuỗi); dữ liệu vẫn nằm trên máy dạng mã hoá, đăng nhập lại cùng tài
  khoản là đọc được. Ai có `data/auth.json` hoặc `data/sessions/` là dùng được — không chia sẻ thư mục dữ liệu.

## Nền tảng web (`platform/`) — MERN, thay máy chủ xác thực cũ từ 05/09/2026

`platform/api` (Express + MongoDB, cổng **4789**) giữ nguyên toàn bộ API đăng nhập/chuỗi mã hoá mà ứng dụng gọi, thêm quản lý
**phiên bản phần mềm** (tải file, đếm lượt tải, kiểm tra cập nhật theo semver), **bài viết CMS**, quản trị người dùng, thống kê.
`platform/web` (React + Vite → nginx, cổng **4790**): trang chủ, **/tai-ve** (tự nhận diện macOS chip Apple / Intel / Windows),
**/cap-nhat** (lịch sử phiên bản), bài viết, hướng dẫn, đăng nhập/đăng ký/quên mật khẩu, tài khoản (phiên đăng nhập, đổi chuỗi mã
hoá). `platform/admin` (**ứng dụng riêng**, cổng **4792**, phục vụ ở `admin.<domain>`): bài viết, phiên bản, người dùng, nội dung
trang chủ — chỉ tài khoản `role: admin`, **chỉ có đăng nhập và quên mật khẩu, không đăng ký** (email trong `ADMIN_EMAILS` được nâng
quyền khi đăng nhập/đăng ký ở trang chính). Hợp đồng API: `platform/API-CONTRACT.md`.

```bash
cd platform && cp .env.example .env   # điền JWT_SECRET, ADMIN_EMAILS, PUBLIC_URL (địa chỉ web người dùng gõ được)
docker compose up -d                   # mongo + api :4789 + web :4790 + admin :4792 (loopback; BIND_IP=0.0.0.0 nếu cần mở ra LAN) + edge
# Máy chủ thật volcanion.vn / admin.volcanion.vn: .env theo .env.production.example (DOMAIN/ADMIN_DOMAIN cho service edge
# = Caddy 80/443 + Let's Encrypt tự động, luôn chạy cùng bộ) rồi CÙNG MỘT LỆNH docker compose up -d. Chuyển dữ liệu Mongo + bộ cài
# từ máy này: platform/DEPLOY.md. Ứng dụng desktop mặc định trỏ https://volcanion.vn từ bản 0.0.2.
# Chuyển dữ liệu từ máy chủ cũ (server/, SQLite): xem platform/api/README.md mục 5 (docker cp → migrate-from-sqlite.mjs);
# người dùng cũ giữ nguyên id + mật khẩu + chuỗi mã hoá + phiên đang đăng nhập.
```

Ứng dụng **tự kiểm tra bản cập nhật** ở máy chủ tài khoản (`GET /api/releases/check`) 20 giây sau khi mở và mỗi 6 giờ, hoặc bấm
*Cài đặt → Kiểm tra cập nhật*. Có bản mới ⇒ thanh 🆕 với *Tải về* (mở trình duyệt), *Xem thay đổi*, *Bỏ qua bản này* (bản bắt buộc
không bỏ qua được). Không tự cài vì bản chưa ký. Phát hành bản mới: admin → Phiên bản → tải file `.dmg`/`.exe` (tự đoán
version/nền tảng/chip từ tên file), viết ghi chú, **Xuất bản**. Cần tăng `version` trong `package.json` trước khi `npm run dist`.

## Máy chủ xác thực cũ (`server/`) — đã thay bằng `platform/api`, giữ để đối chiếu

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
`~/Documents/Zalo Chat Assistant`), `ZCA_SERVER_URL` (mặc định `https://volcanion.vn`; máy dev đặt `http://127.0.0.1:4789`), `PORT` (3789), `OPEN_BROWSER=false`.

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
