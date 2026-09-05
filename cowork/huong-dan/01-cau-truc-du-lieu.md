# 01 · Cấu trúc gói dữ liệu và cách đọc một hội thoại

## 1. Thư mục làm việc là gì

Ứng dụng **Zalo Chat Assistant** chạy trên máy Mac của tư vấn viên, đăng nhập Zalo cá nhân (quét QR) và lưu mọi tin nhắn
đến/đi vào một cơ sở dữ liệu SQLite **đã mã hoá**. Ứng dụng tạo và duy trì MỘT thư mục làm việc cố định
(`~/Documents/Zalo Chat Assistant/`) — người dùng trỏ Claude Cowork vào đó một lần là đủ:

| Đường dẫn | Nội dung | Bạn dùng để |
|---|---|---|
| `CLAUDE.md` | Bản sao của `huong-dan/00-chi-dan-cho-claude.md` để công cụ của Claude tự nạp | Bắt đầu mỗi phiên |
| `huong-dan/` | Bộ chỉ dẫn này + `tham-chieu-meddental/` (dịch vụ, bảng giá, bác sĩ) | Quy tắc và dữ liệu tham chiếu |
| `du-lieu/README-DU-LIEU.md` | Phạm vi thời gian, số hội thoại/tin, quy ước của lần cập nhật gần nhất | Biết dữ liệu hiện có bao phủ gì |
| `du-lieu/00-INDEX.md` | Bảng mọi hội thoại: tên, SĐT, số tin, tin cuối, **Chờ trả lời**, nội dung tin cuối, đường dẫn file | Chọn hội thoại cần xử lý, xếp ưu tiên sơ bộ |
| `du-lieu/hoi-thoai/NNN-<tên>.md` | Toàn bộ tin nhắn của **một** hội thoại, cũ → mới | Đọc chi tiết |
| `du-lieu/tong-hop.csv` | Như 00-INDEX, dạng CSV | Thống kê nhanh |
| `du-lieu/*.xlsx` (nếu có) | Excel, mỗi hội thoại một sheet | Người dùng tự xem |
| `ket-qua/` | Do **bạn** tạo: kết quả tổng hợp/đề xuất | Bàn giao cho tư vấn viên |

Mỗi lần tư vấn viên bấm **"Cập nhật dữ liệu cho Claude"** trong ứng dụng, thư mục `du-lieu/` được **ghi đè** bằng dữ liệu
mới (giải mã từ cơ sở dữ liệu); `ket-qua/` và `huong-dan/` giữ nguyên. Không có ảnh/tệp thật, chỉ có liên kết.

## 2. Một file hội thoại trông thế nào

```
# Hội thoại: Nguyễn Thị Lan

- Loại: 1-1 · Mã thread: `1001` · Mã tài khoản: `770338730752256045`
- SĐT khách: 0912000001
- Tài khoản Zalo của mình: Tư vấn viên Demo (0985018688)
- Khoảng thời gian trong gói: 04/09/2026 08:10:00 → 04/09/2026 08:40:00
- Số tin trong gói: 4 (người kia 3 / bạn 1) · Tổng đã lưu: 4
- Tin cuối: 04/09/2026 08:40:00 do Nguyễn Thị Lan gửi
- **Trạng thái: CHƯA TRẢ LỜI** (người kia nhắn cuối, đã 3.2 giờ — QUÁ HẠN)

## Tin nhắn (cũ → mới)

- **[04/09/2026 08:10:00] Nguyễn Thị Lan:** Chào shop, em muốn hỏi niềng răng trong suốt giá bao nhiêu ạ?
- **[04/09/2026 08:20:00] Bạn:** Chào chị Lan, MedDental có Invisalign và mắc cài…
- **[04/09/2026 08:30:00] Nguyễn Thị Lan:** [Ảnh: anh.jpg](https://…)
- **[04/09/2026 08:40:00] Nguyễn Thị Lan:** Em ở Thanh Xuân thì đến cơ sở nào gần ạ?
```

Quy ước:

- Mỗi dòng tin ghi **tên người gửi** như trong Zalo: `**[thời gian] Nguyễn Thị Lan:** …`; tin của chủ tài khoản ghi
  `**[thời gian] Bạn:** …` (kể cả gửi từ điện thoại). Trong nhóm, mỗi thành viên hiện đúng tên mình. Đầu file nhóm ghi
  `Trạng thái: NHÓM CHAT — không áp dụng "chưa trả lời"`.
- Các file gói cũ (trước 05/09/2026) dùng nhãn `KHÁCH`/`MÌNH`/`THÀNH VIÊN (Tên)` — đọc tương đương.
- **Lịch sử nhóm có thể cũ hơn ngày cài ứng dụng**: Zalo cho lấy vài trăm tin gần nhất của mỗi nhóm khi nhập lịch sử;
  hội thoại 1-1 thì không có cơ chế này.
- Thời gian theo giờ Việt Nam, `dd/MM/yyyy HH:mm:ss`.
- Tin nhiều dòng được thụt vào 2 khoảng trắng ở các dòng sau.
- `> trả lời: …` = tin này trả lời (quote) một tin trước đó.
- `[Ảnh: tên](link)`, `[Tệp: tên](link)`, `[Sticker]`, `[Ghi âm](link)`, `[Video](link)`: chỉ có liên kết; **bạn không
  xem được nội dung ảnh**. Khi ý khách nằm trong ảnh (ảnh răng, ảnh đơn thuốc, ảnh chuyển khoản) hãy ghi
  `[CẦN XÁC NHẬN: nội dung ảnh]` và đề xuất câu trả lời theo hai hướng nếu cần.
- `_(tin này đã bị thu hồi)_`: người gửi đã rút lại; không dựa vào nội dung đó để trả lời.
- **Trạng thái CHƯA TRẢ LỜI** = tin cuối cùng là của người kia. **QUÁ HẠN** = đã quá số giờ người dùng cài (mặc định
  2 giờ). Tin cuối chỉ là "Cảm ơn"/"Ok"/sticker thì vẫn hiện "chưa trả lời" — bạn tự đánh giá là **không cần nhắn**
  (`kind = khong-can`, ghi lý do).

## 3. Giới hạn của dữ liệu — phải biết trước khi kết luận

1. **Không có lịch sử trước ngày cài ứng dụng.** Hội thoại có thể bắt đầu "giữa chừng". Đừng kết luận "khách chưa
   từng được tư vấn" nếu tin đầu tiên trong file đã là câu hỏi nối tiếp.
2. **Chỉ có tin trong khoảng thời gian của gói** (trừ khi tư vấn viên chọn "kèm toàn bộ lịch sử"). Xem dòng "Số tin
   trong gói / Tổng đã lưu": hai số khác nhau nghĩa là còn tin cũ hơn không nằm trong file.
3. **Tin bị lỡ khi máy tắt** có thể được Zalo gửi bù, nhưng không đảm bảo đủ. Thấy hội thoại "nhảy cóc" (khách cảm
   ơn mà không thấy mình trả lời) thì ghi nhận là *có thể thiếu tin*, đừng suy ra tư vấn viên bỏ sót.
4. **Tin MÌNH gửi từ điện thoại vẫn có trong file** — nên tin cuối là MÌNH nghĩa là đã trả lời, dù trả lời bằng
   máy nào.
5. **SĐT khách** có khi trống (khách ẩn số) — không được đoán số.
6. Tên hội thoại là tên hiển thị trên Zalo, có thể là biệt danh — gọi khách theo cách tư vấn viên đã gọi trong tin.
