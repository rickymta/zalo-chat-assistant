# Zalo Chat Assistant

Ứng dụng macOS cho tư vấn viên MedDental: **đăng nhập Zalo cá nhân bằng mã QR**, **tự lưu mọi tin nhắn** đến/đi vào
máy, rồi **xuất gói dữ liệu** để **Claude Cowork** tổng hợp hội thoại và đề xuất câu trả lời. Ứng dụng **chỉ đọc** —
không gửi tin, không đánh dấu đã xem — để giảm rủi ro cho tài khoản.

Dùng cùng thư viện `zca-js` và cùng cách đăng nhập với kênh Zalo cá nhân trong CRM (`backend/services/zalo-personal-bridge`
của repo `mdt-re-construct-research`), nhưng chạy độc lập trên máy cá nhân, không cần máy chủ.

## Dành cho người dùng: cài và dùng trong 3 bước

1. **Cài**: mở file `Zalo Chat Assistant-<phiên bản>-arm64.dmg`, kéo biểu tượng vào **Applications**.
   Lần đầu mở, macOS có thể báo *"không thể mở vì không xác minh được nhà phát triển"* — hãy **bấm chuột phải vào ứng
   dụng → Mở → Mở** (chỉ cần một lần). Nếu vẫn bị chặn, người hỗ trợ kỹ thuật chạy:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Zalo Chat Assistant.app"
   ```
2. **Kết nối Zalo**: bấm *Đăng nhập bằng mã QR* → mở Zalo trên điện thoại → biểu tượng QR cạnh ô tìm kiếm → quét → Đồng ý.
   Từ lúc này, cứ để ứng dụng chạy (đóng cửa sổ vẫn chạy nền; thoát hẳn bằng ⌘Q). Bật *Cài đặt → Tự mở khi bật máy*.
3. **Xuất cho Claude**: bấm *⏳ Đang chờ trả lời* (hoặc *Hôm nay* / *7 ngày* / *Tất cả*). Ứng dụng tạo một thư mục trong
   `~/Documents/Zalo Chat Assistant/` và mở Finder. Mở **Claude Cowork** tại thư mục đó, dán câu:
   > Đọc `huong-dan/00-chi-dan-cho-claude.md` rồi tổng hợp các hội thoại đang chờ trả lời và đề xuất phản hồi.

   Claude trả về bảng ưu tiên + phiếu từng hội thoại kèm câu trả lời gợi ý (ghi ở `ket-qua/`). Tư vấn viên đọc, sửa,
   rồi tự gửi trên Zalo.

### Những điều phải biết

- **Hội thoại 1-1 chỉ có tin từ lúc cài ứng dụng** (cộng phần tin Zalo gửi bù khi nối lại sau lúc tắt máy). Tin cũ
  hơn không lấy được — Zalo không có API lịch sử 1-1 cho tài khoản cá nhân.
- **Nhóm chat thì có lịch sử**: lần đầu kết nối, ứng dụng tự nhập vài trăm tin gần nhất của **mỗi** nhóm (mặc định
  300, đổi ở Cài đặt), chạy nền, nghỉ ~1 giây giữa các nhóm. Bấm *Cài đặt → Nhập lịch sử nhóm* để lấy lại bất cứ lúc
  nào. Nhóm KHÔNG áp dụng "đang chờ trả lời" — Claude tổng hợp nhóm theo chủ đề, việc cần làm và câu hỏi hướng tới mình
  (`cowork/02-quy-trinh-tong-hop.md` mục 7).
- **Đừng mở Zalo Web (chat.zalo.me) trên trình duyệt** cùng lúc: một số chỉ chạy được một phiên web, mở ở chỗ khác là
  ứng dụng rớt kết nối và hiện *Cần đăng nhập lại*. Zalo trên **điện thoại** dùng bình thường.
- **Tài khoản có thể bị Zalo khoá** vì đây là giao thức không chính thức. Dùng số công ty cấp, không dùng số cá nhân
  thật. Không đăng nhập/đăng xuất liên tục, không chạy cùng một số trên nhiều máy.
- Ảnh/tệp chỉ lưu **liên kết**, không tải về; liên kết Zalo có thể hết hạn.
- Toàn bộ dữ liệu nằm **trên máy này**, không gửi đi đâu. Phiên đăng nhập (cookie) lưu trong
  `~/Library/Application Support/Zalo Chat Assistant/data/sessions/` — ai có file đó là dùng được tài khoản Zalo;
  đừng sao chép/chia sẻ thư mục `data`. Gói xuất trong `Documents` **không** chứa cookie, chia sẻ được.

## Dành cho người kỹ thuật

### Kiến trúc

```
electron/main.js     Vỏ ứng dụng macOS (cửa sổ, menu, chạy nền, tự mở khi bật máy) → gọi src/app.js
src/app.js           Lõi: mở SQLite, khởi động máy chủ HTTP cục bộ (127.0.0.1), khôi phục phiên Zalo
src/zalo/manager.js  Đăng nhập QR / khôi phục phiên / listener zca-js / ghi tin (selfListen: true) / nhập lịch sử nhóm (getGroupChatHistory)
src/zalo/normalize.js  Chuẩn hoá tin zca-js → dòng SQLite (bảng msgType giống CRM)
src/db.js            SQLite (WAL): accounts, conversations, messages (chống trùng theo msgId), contacts, exports
src/export/          markdown.js (gói cho Cowork, mỗi hội thoại 1 file) · excel.js (streaming, 1 sheet/hội thoại)
src/server.js        API + SSE cho giao diện · src/ui/index.html  Giao diện 3 bước (vanilla JS)
src/index.js         Chạy bằng Node thuần, mở trình duyệt · src/cli-export.js  Xuất bằng dòng lệnh
cowork/              Bộ chỉ dẫn cho Claude Cowork — được chép vào mỗi gói xuất (thư mục huong-dan/)
```

**Kho lưu chính là SQLite**, không phải Excel: người dùng mục tiêu có hàng nghìn hội thoại và tin đến liên tục; Excel
không chịu được ghi nối + chống trùng. Excel/Markdown là đầu ra xuất theo yêu cầu. Gói Markdown là định dạng khuyến
nghị cho Claude (đọc thẳng, nạp từng hội thoại); Excel là tuỳ chọn cho người cần lọc/chia sẻ.

### Chạy bằng Node (máy dev, Node ≥ 20)

```bash
npm install
npm start                 # mở http://127.0.0.1:3789 trong trình duyệt
npm run seed:demo         # gieo dữ liệu mẫu (đặt ZCA_DATA_DIR để không đụng dữ liệu thật)
npm run export -- --days 7 --format markdown,excel
```

Biến môi trường: `ZCA_DATA_DIR` (thư mục dữ liệu, mặc định `./data`), `ZCA_EXPORTS_DIR` (mặc định `<data>/exports`),
`PORT` (3789), `OPEN_BROWSER=false`.

### Chạy / đóng gói bản Electron

```bash
npm run app        # chạy cửa sổ Electron (tự dựng lại better-sqlite3 cho Electron)
npm run icon       # tạo lại build/icon.icns từ build/icon.svg (qlmanage + iconutil)
npm run dist       # tạo dist/Zalo Chat Assistant-<ver>-arm64.dmg
npm run dist:all   # thêm bản x64 cho Mac Intel
```

`better-sqlite3` là module native, bản build cho Node và cho Electron **không dùng chung** — `scripts/ensure-native.js`
tự dựng lại đúng runtime trước mỗi lệnh (`npm start` ↔ `npm run app`), nên đổi qua lại hai chế độ chỉ chậm vài giây.

**Ký và công chứng (để người dùng không phải chuột phải → Mở):** cần Apple Developer ID. Đặt biến
`CSC_LINK`/`CSC_KEY_PASSWORD` (chứng chỉ) và `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` rồi thêm
`"notarize": true` vào `build.mac` trong `package.json`; `electron-builder` sẽ ký + công chứng. Không có chứng chỉ thì
bản dmg vẫn chạy, chỉ thêm bước chuột phải → Mở ở lần đầu.

### Cập nhật tài liệu cho Claude

- Sửa trong `cowork/`; gói xuất tiếp theo nhận bản mới. Bản `.app` phải đóng gói lại.
- Dữ liệu dịch vụ / bảng giá / bác sĩ (`cowork/du-lieu/`) là bản sao từ repo marketing:
  `bash scripts/sync-brand-docs.sh [đường-dẫn-repo]`.

### Vị trí dữ liệu

| Chế độ | Dữ liệu (SQLite, phiên, log) | Gói xuất |
|---|---|---|
| `.app` | `~/Library/Application Support/Zalo Chat Assistant/data/` | `~/Documents/Zalo Chat Assistant/` |
| Node | `./data/` (hoặc `ZCA_DATA_DIR`) | `./data/exports/` (hoặc `ZCA_EXPORTS_DIR`) |

### Khắc phục sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| *Cần đăng nhập lại* ngay sau khi vừa kết nối | Có phiên Zalo Web khác (trình duyệt) — đóng nó rồi *Quét QR lại* |
| Mã QR không hiện | Mất mạng, hoặc Zalo đổi giao thức → nâng `zca-js` (`npm i zca-js@latest`) rồi đóng gói lại |
| Tin của khách không thấy | Kiểm tra pill trạng thái; mở *Nhật ký hoạt động* ở cuối trang; thử *Lấy tin bỏ lỡ* |
| Hội thoại không có tên/SĐT | Bấm *Đồng bộ danh bạ* (chỉ có tên/SĐT của người trong danh bạ và cho phép hiện số) |
| Tin nhóm không được lưu | Mặc định tắt — bật ở *Cài đặt → Lưu cả tin nhắn trong nhóm* |
| Excel mở chậm | Quá nhiều sheet — xuất theo *Đang chờ trả lời* hoặc theo khoảng ngày |
| `NODE_MODULE_VERSION` mismatch | Chạy đúng lệnh npm (`start`/`app`) để `ensure-native` dựng lại module |
