# 04 · Mẫu đầu ra (định dạng bàn giao)

Ghi kết quả vào `ket-qua/YYYY-MM-DD-tong-hop.md` trong gói (tạo thư mục nếu chưa có), đồng thời trả lời tóm tắt trong
chat (số hội thoại đã xử lý, mấy P1, việc cần người quyết). Dùng đúng thứ tự A → B → (C nếu được yêu cầu).

## A. Bảng ưu tiên

```
# Tổng hợp tin nhắn Zalo — <ngày giờ tạo>
Gói: <tên thư mục gói> · <n> hội thoại chờ trả lời đã xử lý · P1: <n> · P2: <n> · P3: <n> · Không cần trả lời: <n>

| Ưu tiên | Khách | Chờ (giờ) | Nhu cầu | Tóm tắt 1 dòng | File |
|---|---|---|---|---|---|
| P1 | Vũ Ngọc Mai | 6.5 | Sau nhổ răng, đau nhiều | Nhổ răng khôn hôm qua, đau tăng, hỏi có sao không | hoi-thoai/006-vu-ngoc-mai.md |
| P2 | Nguyễn Thị Lan | 3.2 | Hỏi giá + cơ sở gần | Hỏi giá Invisalign, đã gửi ảnh, hỏi cơ sở gần Thanh Xuân | hoi-thoai/001-nguyen-thi-lan.md |
```

## B. Phiếu từng hội thoại (một khối cho mỗi hội thoại, theo thứ tự bảng A)

```
## [P2] Nguyễn Thị Lan — hoi-thoai/001-nguyen-thi-lan.md

**Tóm tắt:** Khách hỏi giá niềng răng trong suốt lúc 08:10; tư vấn viên đã giới thiệu hai phương pháp và xin ảnh; khách
gửi ảnh (không đọc được nội dung) và hỏi cơ sở gần Thanh Xuân lúc 08:40. Chưa ai trả lời từ đó (chờ 3,2 giờ).

**Khách cần gì:** (1) giá tham khảo Invisalign; (2) cơ sở gần Thanh Xuân.
**Giai đoạn:** đang tư vấn, chưa có lịch. **Cảm xúc:** bình thường.
**Chưa được trả lời:** cả hai câu trên. **Việc đã hứa:** "để bác sĩ tư vấn sơ bộ sau khi có ảnh" — chưa thực hiện.
**Thông tin đã có:** khách xưng "em", tư vấn viên gọi "chị Lan"; khách ở Thanh Xuân; đã gửi 1 ảnh.

**Đề xuất phản hồi (dán vào Zalo):**
Chị Lan ơi, em nhận được ảnh rồi ạ, em đã chuyển bác sĩ xem sơ bộ và sẽ báo lại chị trong chiều nay nhé.
Về chi phí, Invisalign có nhiều gói tuỳ mức độ răng, giá tham khảo em gửi chị ở bảng giá bên dưới; con số chính xác bác sĩ sẽ báo sau khi khám và chụp phim ạ.
Chị ở Thanh Xuân thì tiện nhất là MedDental Khuất Duy Tiến (số 03 Khuất Duy Tiến) hoặc Lê Văn Lương (31 ngõ 23 Lê Văn Lương), mở cửa 7h–17h hằng ngày. Chị muốn qua khám ngày nào để em giữ lịch ạ?

**Ghi chú cho tư vấn viên:** [CẦN XÁC NHẬN: giá Invisalign hiện tại — bảng giá trong gói là bản 08/2023]; nội dung ảnh
chưa xem được, nếu ảnh không phải ảnh răng thì bỏ câu đầu. **Hành động tiếp:** gửi bảng giá tham khảo, xin bác sĩ nhận
xét ảnh, chốt lịch.
```

Quy tắc trình bày phiếu:

- Phần **Đề xuất phản hồi** là văn bản thuần, nhiều dòng, không markdown, không ngoặc vuông (ngoặc vuông chỉ nằm ở
  phần Ghi chú). Nếu bắt buộc có chỗ trống thì viết `[tên cơ sở]` và nói rõ trong Ghi chú.
- Hội thoại **không cần trả lời** chỉ xuất hiện trong danh sách cuối, dạng: `- Trần Văn Hùng — tin cuối "Cảm ơn em" — không cần trả lời`.
- Hội thoại **P1** thêm dòng đầu phiếu: `⚠️ Nên GỌI ĐIỆN thay vì nhắn.` khi có dấu hiệu y khoa khẩn hoặc khiếu nại.

## C. Báo cáo ngày / tuần (khi được yêu cầu)

```
# Báo cáo tin nhắn Zalo — <khoảng thời gian>

## Số liệu
- Hội thoại có tin: <n> · tin khách: <n> · tin mình: <n> · hội thoại còn chờ trả lời cuối kỳ: <n>
- Thời gian chờ trung bình / lâu nhất (ước tính từ mốc tin): <n> giờ / <n> giờ

## Nhu cầu theo nhóm
| Nhóm | Số hội thoại | Ví dụ |
|---|---|---|
| Hỏi giá | 12 | răng sứ, Invisalign |

## Câu hỏi lặp lại nhiều (đề xuất soạn tin mẫu)
1. "Niềng trong suốt giá bao nhiêu?" — 6 lần → mẫu tin: …

## Cảnh báo
- 2 khách kể đau sau điều trị chưa được trả lời (P1): <tên, file>
- 3 lời hứa "gọi lại" chưa thực hiện: <tên, file>

## Đề xuất
- …
```

Mọi con số trong báo cáo phải đếm được từ gói; không ước lượng ngoài dữ liệu.
