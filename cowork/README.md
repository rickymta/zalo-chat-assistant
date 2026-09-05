# Thư mục làm việc với Claude Cowork — Zalo Chat Assistant

Trỏ Claude Cowork vào **đúng thư mục này** một lần. Ứng dụng Zalo Chat Assistant tự duy trì nội dung bên trong:

| Thư mục / file | Ai ghi | Nội dung |
|---|---|---|
| `CLAUDE.md` | Ứng dụng | Chỉ dẫn cho Claude (bản sao `huong-dan/00-chi-dan-cho-claude.md`) — Claude tự nạp |
| `huong-dan/` | Ứng dụng | Bộ chỉ dẫn 00–06 + `tham-chieu-meddental/` (dịch vụ, bảng giá, bác sĩ) |
| `du-lieu/` | Ứng dụng | Dữ liệu hội thoại đã giải mã — **ghi đè** mỗi lần bấm "Cập nhật dữ liệu cho Claude" |
| `ket-qua/` | Claude | Bản tổng hợp và đề xuất phản hồi |

Câu mở đầu mỗi phiên: *"Đọc `huong-dan/00-chi-dan-cho-claude.md` rồi tổng hợp các hội thoại đang chờ trả lời và đề xuất phản hồi."*

⚠️ `du-lieu/` là bản **giải mã** của tin nhắn để Claude đọc được. Không cần nữa thì bấm "Xoá dữ liệu đã chuẩn bị" trong
Cài đặt của ứng dụng (hoặc xoá thư mục `du-lieu/`); cơ sở dữ liệu gốc trong ứng dụng vẫn được mã hoá.
