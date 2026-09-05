# 04 · Mẫu đầu ra (định dạng bàn giao)

Ghi kết quả vào `ket-qua/YYYY-MM-DD-tong-hop.md` (thư mục `ket-qua/` có sẵn ở thư mục làm việc), đồng thời trả lời tóm tắt trong
chat (số hội thoại đã xử lý, mấy P1, việc cần người quyết). Dùng đúng thứ tự A → B → (C nếu được yêu cầu).

## A. Bảng ưu tiên

```
# Tổng hợp tin nhắn Zalo — <ngày giờ tạo>
Gói: <tên thư mục gói> · <n> hội thoại chờ trả lời đã xử lý · P1: <n> · P2: <n> · P3: <n> · Không cần trả lời: <n>

| Ưu tiên | Hội thoại | Quan hệ | Chờ (giờ) | Loại gợi ý | Tóm tắt 1 dòng | File |
|---|---|---|---|---|---|
| P1 | Vũ Ngọc Mai | 6.5 | Sau nhổ răng, đau nhiều | Nhổ răng khôn hôm qua, đau tăng, hỏi có sao không | du-lieu/hoi-thoai/006-vu-ngoc-mai.md |
| P2 | Nguyễn Thị Lan | 3.2 | Hỏi giá + cơ sở gần | Hỏi giá Invisalign, đã gửi ảnh, hỏi cơ sở gần Thanh Xuân | du-lieu/hoi-thoai/001-nguyen-thi-lan.md |
```

## B. Phiếu từng hội thoại (một khối cho mỗi hội thoại, theo thứ tự bảng A)

```
## [P2] Nguyễn Thị Lan — du-lieu/hoi-thoai/001-nguyen-thi-lan.md
**Loại gợi ý:** trả lời (người kia nhắn cuối) · **Quan hệ:** khách hàng

**Tóm tắt:** Khách hỏi giá niềng răng trong suốt lúc 08:10; tư vấn viên đã giới thiệu hai phương pháp và xin ảnh; khách
gửi ảnh (không đọc được nội dung) và hỏi cơ sở gần Thanh Xuân lúc 08:40. Chưa ai trả lời từ đó (chờ 3,2 giờ).

**Người đối thoại cần gì:** (1) giá tham khảo Invisalign; (2) cơ sở gần Thanh Xuân.
**Giai đoạn:** đang tư vấn, chưa có lịch. **Cảm xúc:** bình thường.
**Chưa được trả lời:** cả hai câu trên. **Việc Bạn đã hứa:** "để bác sĩ tư vấn sơ bộ sau khi có ảnh" — chưa thực hiện.
**Thông tin đã có:** người kia xưng "em", Bạn gọi "chị Lan"; ở Thanh Xuân; đã gửi 1 ảnh.

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

## D. Phiếu NHÓM chat (một khối cho mỗi nhóm, đặt sau phần B)

```
## [Nhóm] Khách hàng Nguyễn Văn A — Implant — du-lieu/hoi-thoai/012-khach-hang-nguyen-van-a-implant.md
Loại nhóm: nhóm khách hàng (khách + vợ + tư vấn viên + BS. Bình). Khoảng đã đọc: 29/08 → 04/09/2026 · 86 tin.

**Chủ đề đã bàn**
1. Lịch cấy Implant răng 36 — chốt 06/09 9h tại Nghĩa Dũng (BS. Bình chốt 02/09 15:10).
2. Khách hỏi chi phí ghép xương phát sinh (03/09 20:41) — chưa ai trả lời.
3. Vợ khách hỏi ăn uống trước phẫu thuật (04/09 07:30) — BS. Bình đã trả lời 08:05.

**Quyết định / chốt:** lịch 06/09 9h; thanh toán đợt 1 đã xong (khách gửi ảnh chuyển khoản 01/09, chưa đọc được nội dung).
**Việc cần làm:** [MÌNH] gửi hướng dẫn trước phẫu thuật — hứa 02/09, chưa thấy gửi · [BS. Bình] xem lại phim CT — đã xong 03/09.
**Câu hỏi hướng tới mình chưa trả lời:** "chi phí ghép xương bao nhiêu" (03/09 20:41, chờ 14 giờ) → P1.
**Rủi ro / phàn nàn:** không.
**Thông tin cần lưu:** SĐT vợ khách 09xx… (tin 30/08 10:12).

**Đề xuất phản hồi (dán vào nhóm):**
Anh A ơi, về chi phí ghép xương em xin lỗi vì trả lời muộn ạ. Phần này phụ thuộc lượng xương cần ghép sau khi bác sĩ xem phim, nên em sẽ xin bác sĩ Bình con số cụ thể và nhắn riêng cho anh trong sáng nay. Hướng dẫn trước phẫu thuật em cũng gửi ngay sau đây để anh và chị chuẩn bị nhé.

**Ghi chú cho tư vấn viên:** [CẦN XÁC NHẬN: chi phí ghép xương theo phim]; gửi hướng dẫn tiền phẫu đã hứa từ 02/09; ảnh chuyển khoản chưa xem được.
```

Nhóm không có việc của mình và không có câu hỏi hướng tới mình thì chỉ giữ phần **Chủ đề đã bàn** + **Quyết định** (tối đa 6 dòng).

## E. BẮT BUỘC kèm file máy đọc `ket-qua/de-xuat.json`

Ứng dụng Zalo Chat Assistant đọc file này để hiện gợi ý **ngay trong màn Hội thoại** (tư vấn viên bấm là điền sẵn vào ô
soạn tin). Mỗi lần bàn giao, ngoài file `.md` ở mục A–D, **ghi đè** `ket-qua/de-xuat.json` với cấu trúc:

```json
{
  "createdAt": "2026-09-05T08:15:00+07:00",
  "items": [
    {
      "threadId": "1001",
      "accountId": "770338730752256045",
      "name": "Nguyễn Thị Lan",
      "kind": "tra-loi",
      "priority": "P2",
      "summary": "Hỏi giá Invisalign, đã gửi ảnh, hỏi cơ sở gần Thanh Xuân; chờ 3,2 giờ.",
      "reply": "Chị Lan ơi, em nhận được ảnh rồi ạ…\nChị ở Thanh Xuân thì tiện nhất là MedDental Khuất Duy Tiến…",
      "notes": "[CẦN XÁC NHẬN: giá Invisalign hiện tại]",
      "nextAction": "Gửi bảng giá tham khảo, chốt lịch.",
      "file": "du-lieu/hoi-thoai/001-nguyen-thi-lan.md"
    }
  ]
}
```

Quy tắc:

- `threadId` và `accountId` lấy từ dòng "Mã thread" / "Mã tài khoản" ở đầu file hội thoại — **bắt buộc có `threadId`**.
- `kind`: `tra-loi` | `theo-doi` | `nhom` | `khong-can` (xem file 00). **MỌI hội thoại trong gói đều có một mục**; với
  `khong-can` thì `reply` là chuỗi rỗng và bắt buộc có `reason` (một câu, vd "Khách đã cảm ơn và kết, chờ khách chủ động").
- `reply` là **đúng văn bản dán vào Zalo** (nhiều dòng dùng `\n`, không markdown).
- `priority`: `P1` | `P2` | `P3` (tin theo dõi thường `P3`; `khong-can` để `null`).
- Một hội thoại chỉ một mục; nếu có phương án A/B thì ghép vào `reply` bằng hai đoạn có tiêu đề "Phương án A:" / "Phương án B:".
- File `.md` vẫn là bản người đọc; `de-xuat.json` là bản máy đọc — hai bản phải khớp nhau.

## F. BẮT BUỘC kèm BÁO CÁO NGÀY `ket-qua/bao-cao/YYYY-MM-DD.json` (+ `.md`)

Tổng hợp nội dung là sản phẩm chính; gợi ý phản hồi chỉ là một mục. Mỗi lần chạy, ngoài `de-xuat.json`, ghi đè báo cáo của
NGÀY HÔM NAY (giờ Việt Nam) — ứng dụng hiện báo cáo này trong hộp thoại "📊 Báo cáo":

```json
{
  "date": "2026-09-05",
  "generatedAt": "2026-09-05T10:40:00+07:00",
  "overview": {
    "summary": "3–5 câu: hôm nay có gì đáng chú ý trên toàn bộ hội thoại (việc lớn, người cần ưu tiên, rủi ro).",
    "highlights": ["Chị Lan (Invisalign) chờ báo giá từ sáng", "Nhóm CRM chốt lịch demo thứ 3", "Anh Hùng đổi giờ khám"]
  },
  "conversations": [
    {
      "threadId": "1001", "accountId": "770338730752256045", "name": "Nguyễn Thị Lan",
      "relation": "khach-hang", "relationNote": "Khách hỏi giá niềng, chưa từng đến khám",
      "summary": "2–4 câu tóm tắt DIỄN BIẾN hội thoại trong ngày (ai nói gì, kết quả tới đâu).",
      "topics": ["Giá Invisalign", "Cơ sở gần Thanh Xuân"],
      "decisions": ["Chị Lan sẽ qua khám thứ 7"],
      "tasksForYou": ["Gửi bảng giá tham khảo Invisalign", "Giữ lịch 9h thứ 7 Khuất Duy Tiến"],
      "openQuestions": ["Bọc răng sứ có bảo hành không?"],
      "sentiment": "binh-thuong",
      "kind": "tra-loi"
    }
  ],
  "actionItems": [ { "threadId": "1001", "name": "Nguyễn Thị Lan", "task": "Gửi bảng giá tham khảo Invisalign", "due": "hôm nay", "priority": "P2" } ]
}
```

Quy tắc: `relation` PHẢI là đúng MỘT trong 6 mã `khach-hang | dong-nghiep | doi-tac | ban-be | nhom | khac` (suy từ nội
dung; đồng nghiệp/nội bộ/cấp trên/cấp dưới → `dong-nghiep`; nhóm toàn đồng nghiệp cũng ghi `dong-nghiep`, `nhom` chỉ cho
nhóm hỗn hợp/cộng đồng) — KHÔNG viết câu vào trường này; muốn giải thích thì thêm `"relationNote": "≤ 1 câu"`. `sentiment`
chỉ nhận 5 mã `binh-thuong | tich-cuc | lo-lang | khong-hai-long | khan` (không dùng `trung-tinh`). `kind` như mục E.
`generatedAt` bắt buộc (ISO 8601 có +07:00). Mỗi mục `actionItems` gồm đúng các khoá `threadId`, `name`, `task`, và tuỳ chọn
`due`, `priority` (P1/P2/P3) — không đổi tên khoá (ví dụ không dùng `conversation` thay `name`). Mỗi hội thoại CÓ TIN trong ngày là một mục;
hội thoại không có tin mới trong ngày thì không đưa vào. `actionItems` gom mọi việc của Bạn từ các hội thoại, ưu tiên
theo độ khẩn. File `.md` cùng tên là bản người đọc: tiêu đề ngày, đoạn tổng quan, điểm nổi bật, rồi mỗi hội thoại một mục.
