# Nâng cấp: tổng hợp đa nguồn (Zalo · Telegram · Email · Lark Approval) bằng AI cục bộ, bản tin giọng nói qua Telegram

*Hợp đồng thực thi — 09/09/2026. Nguồn sự thật cho đợt nâng cấp; sửa ở đây trước khi sửa mã.*

## 0. Yêu cầu và các chốt của người dùng

| # | Yêu cầu | Chốt |
|---|---|---|
| 1 | Tổng hợp hội thoại các **nhóm Telegram** | Đọc bằng **tài khoản cá nhân** (MTProto, đăng nhập số điện thoại + mã + 2FA), không dùng bot để đọc |
| 2 | Tổng hợp **email** | **IMAP** máy chủ mail khác (host/cổng/tài khoản/mật khẩu) |
| 3 | Tổng hợp **phiếu duyệt Lark Approval** | Lark Open API (tenant token), app_id/app_secret do người dùng cấp |
| 4 | Thay Claude Cowork bằng **model AI cục bộ** trên **Mac mini M1 8 GB** | Không Ollama; người dùng gợi ý ứng dụng Python tự xây; **hạn chế số ứng dụng phải cài** |
| 5 | Tổng hợp mọi nguồn → **giọng nói** → đẩy vào **Telegram qua chatbot** | **edge-tts** (giọng vi-VN tự nhiên, cần mạng lúc tạo giọng) |

## 1. Quyết định kiến trúc

**D1 — Bộ máy AI chạy ngay trong ứng dụng, không cài thêm gì.** Dùng `node-llama-cpp` (prebuilt `mac-arm64-metal`,
chạy ở main process của Electron) nạp model GGUF. So với "ứng dụng Python tự xây": cùng lõi llama.cpp, nhưng không cần
người dùng cài Python/pip/venv, không có tiến trình thứ hai để quản lý, một bộ cài .dmg là đủ. Nếu về sau muốn tách,
`src/ai/engine.js` là điểm duy nhất phải đổi (hợp đồng: `summarize(prompt, schema) → JSON`).
- Model mặc định cho 8 GB: **Qwen2.5-3B-Instruct Q4_K_M** (~2,0 GB, tiếng Việt tốt trong tầm 3B, ngữ cảnh 32k). Thay được
  trong Cài đặt bằng URL/đường dẫn GGUF khác (Gemma 3 4B it Q4 ~2,5 GB; Gemma 4 e2b GGUF khi có bản ổn định). Tải lần đầu
  từ Hugging Face có thanh tiến độ, lưu ở `data/models/`.
- Chạy **tuần tự** từng hội thoại/thư/phiếu (một context, `contextSize` 8192, `gpuLayers: auto`), ép đầu ra bằng
  **JSON schema grammar** đúng mục E/F của `cowork/huong-dan/04-mau-dau-ra.md` ⇒ ghi **đúng các file `ket-qua/`** hiện có
  (`de-xuat.json`, `bao-cao/YYYY-MM-DD.json` + `.md`, `YYYY-MM-DD-tong-hop.md`) ⇒ giao diện gợi ý/báo cáo dùng nguyên.
- Cài đặt → *Bộ máy AI*: **Cục bộ (mặc định)** hoặc **Claude Cowork** (giữ pipeline cũ cho máy có Claude).

**D2 — Ba nguồn mới dùng chung SQLite đã mã hoá.** Bảng `sources` (kind: `zalo | telegram | email | lark`, tài khoản, trạng
thái) và `items` (một tin/thư/phiếu: id nguồn, thời gian, người gửi, tiêu đề, nội dung mã hoá, meta JSON mã hoá). Zalo giữ
bảng cũ (`messages`) — không di trú. Gói dữ liệu `du-lieu/` thêm thư mục `telegram/`, `email/`, `lark/` cùng quy ước Markdown
để pipeline Cowork (nếu còn dùng) cũng đọc được.

**D3 — Bản tin giọng nói.** Một "bản tin" = tổng hợp theo phiên (mặc định **07:30** và **17:30**, cấu hình) từ tóm tắt
từng nguồn → model viết văn bản đọc 2–4 phút (ưu tiên: việc cần anh xử lý, phiếu chờ duyệt, khách chờ trả lời, thư quan
trọng) → `msedge-tts` giọng `vi-VN-HoaiMyNeural` (đổi được `NamMinh`) → **Opus/WebM** → Telegram Bot API `sendVoice` +
`sendMessage` (văn bản đầy đủ) tới `chat_id` cấu hình. Nút **Gửi bản tin ngay** trong app. Dự phòng khi edge-tts lỗi mạng:
`say -v Linh` của macOS.

**D4 — Nguyên tắc an toàn giữ nguyên.** Ứng dụng chỉ ĐỌC Zalo/Telegram/Email/Lark; không đánh dấu đã đọc (IMAP dùng PEEK),
không trả lời tự động, không chuyển tiếp nội dung ra ngoài ngoài bản tin gửi tới đúng `chat_id` của người dùng qua bot của
họ. Mọi bí mật (phiên Telegram, mật khẩu IMAP, app_secret Lark, bot token) lưu mã hoá trong `data/` bằng chuỗi mã hoá hiện có.

## 2. Phân rã feature (mỗi feature = một commit, dừng cho người dùng thử)

| F | Nội dung | Nghiệm thu |
|---|---|---|
| **F1** | `src/ai/`: engine node-llama-cpp (nạp/tải model, tiến độ, hàng đợi tuần tự), `local-pipeline.js` chạy lại quy trình tóm tắt Zalo bằng model cục bộ, ghi `ket-qua/*` như Cowork; Cài đặt chọn bộ máy | Mac này: chọn Cục bộ → gợi ý + báo cáo ngày hiện ra từ model cục bộ; thời gian/hội thoại ghi log |
| **F2** | Telegram cá nhân (`telegram` gramjs): đăng nhập SĐT → mã → 2FA trong app; chọn nhóm theo dõi; kéo lịch sử N ngày + lắng nghe realtime; lưu `items`; xuất `du-lieu/telegram/`; tóm tắt | Nhóm chọn hiện trong cột hội thoại với nhãn Telegram; tóm tắt xuất hiện |
| **F3** | Email IMAP (`imapflow` + `mailparser`): cấu hình, kiểm tra kết nối, lấy thư mới theo UID (PEEK), tóm tắt (tiêu đề, người gửi, ý chính, việc cần làm) | Danh sách thư + tóm tắt; không đổi trạng thái thư trên máy chủ |
| **F4** | Lark Approval: tenant token, `approval/v4/instances` theo mã phiếu + khoảng thời gian, chi tiết form, phân loại chờ tôi duyệt / đã duyệt / từ chối | Danh sách phiếu + tóm tắt; số phiếu chờ duyệt lên bản tin |
| **F5** | Bản tin: gộp tóm tắt đa nguồn → văn bản đọc → edge-tts → Opus → bot `sendVoice` + `sendMessage`; lịch 2 phiên/ngày; nút Gửi ngay; lưu lịch sử bản tin | Nhận được voice + text trong Telegram; nghe được, đúng nội dung |
| **F6** | Giao diện: bộ lọc nguồn ở cột 1 (Tất cả · Zalo · Telegram · Email · Lark), thẻ Cài đặt cho AI/Telegram/Email/Lark/Bản tin, trạng thái từng nguồn trên thanh trên | Người không kỹ thuật cấu hình được theo hướng dẫn trong app |
| **F7** | Build arm64 cho Mac mini, tài liệu cài đặt (không Docker, không Python), phát hành 0.1.0 | Cài trên Mac mini 8 GB: nạp model, chạy một vòng bản tin |

## 3. Người dùng cần cung cấp (nhập trong Cài đặt của app, không gửi cho ai)

- Telegram: **API ID + API Hash** (tạo miễn phí tại my.telegram.org → API development tools), số điện thoại để đăng nhập.
- Bot Telegram nhận bản tin: **bot token** (@BotFather) và **chat_id** (chat riêng với bot hoặc nhóm/kênh anh chọn).
- IMAP: host, cổng (993), tài khoản, mật khẩu (mật khẩu ứng dụng nếu có), thư mục cần đọc.
- Lark: **App ID/App Secret** của ứng dụng nội bộ có quyền đọc Approval; **approval_code** của các quy trình cần theo dõi.

## 4. Rủi ro và giới hạn đã biết

- **8 GB RAM**: model 3B Q4 chiếm ~2–2,5 GB + KV cache; chạy tuần tự, mỗi hội thoại 20–60 giây trên M1. Không chạy song song
  với ứng dụng nặng khác. Bản tin được lên lịch ngoài giờ cao điểm.
- **edge-tts** là API không chính thức của Microsoft: có thể đổi/ngắt; đã có dự phòng `say`.
- **Telegram user API**: giới hạn tần suất (flood wait) — kéo lịch sử theo lô, nghỉ giữa các nhóm; phiên đăng nhập là bí
  mật ngang mật khẩu, lưu mã hoá.
- **Chất lượng tóm tắt** của model 3B kém Claude rõ rệt ở hội thoại dài, nhiều người: cắt cửa sổ theo ngày, tóm tắt hai
  tầng (từng khối → gộp). Người dùng nên thử vài ngày rồi quyết định có nâng RAM/đổi model không.
- **Lark**: cần quyền `approval:approval:readonly` được duyệt trong Lark Admin; API trả form dạng JSON string — chỉ tóm tắt
  các trường văn bản.

## 5. Trạng thái

- 09/09/2026: hợp đồng viết xong; chờ người dùng xác nhận D1 (engine trong app thay vì ứng dụng Python riêng) rồi bắt đầu F1.
