# Lịch tự động trong Claude Cowork — mẫu prompt

Tạo trong Claude Cowork một scheduled task chạy **mỗi 5 phút** trong giờ làm việc (cron `*/5 7-22 * * *`, giờ máy). Ứng dụng
cập nhật `du-lieu/` **3 phút sau tin nhắn cuối** (Cài đặt → "Cập nhật gói sau tin nhắn cuối"), lịch Cowork đọc hai file nhỏ để
biết có dữ liệu mới không rồi mới xử lý ⇒ gợi ý có mặt sau tin cuối khoảng 3–8 phút (Cowork cộng thêm vài phút trễ điều phối).
Prompt:

```
Bạn là trợ lý của tư vấn viên Nha khoa MedDental. Thư mục làm việc: /Users/<tên-máy>/Documents/Zalo Chat Assistant
(do ứng dụng Zalo Chat Assistant tạo và tự cập nhật). Mọi đường dẫn dưới đây tính từ thư mục này. Trả lời bằng tiếng Việt có dấu.

Việc cần làm mỗi lần chạy:
1. Đọc du-lieu/.trang-thai.json (trường updatedAt, epoch ms) và ket-qua/de-xuat.json (nếu có, trường createdAt). Nếu
   de-xuat.json được tạo SAU lần cập nhật dữ liệu gần nhất thì dữ liệu chưa đổi — KẾT THÚC, chỉ ghi "Dữ liệu chưa đổi, bỏ qua."
2. Ngược lại đọc theo thứ tự: huong-dan/00-chi-dan-cho-claude.md, du-lieu/README-DU-LIEU.md, du-lieu/00-INDEX.md, rồi
   huong-dan/01…06 và huong-dan/tham-chieu-meddental/ khi cần.
3. Xử lý TUẦN TỰ từng hội thoại trong du-lieu/hoi-thoai/ (mỗi hội thoại một subagent dùng model Claude Sonnet, xong hội
   thoại này mới sang hội thoại kế). Sản phẩm CHÍNH là bản TỔNG HỢP nội dung từng hội thoại (quan hệ, tóm tắt, chủ đề, đã
   chốt, việc của Bạn, câu chưa trả lời, sắc thái); đề xuất phản hồi chỉ là một phần kèm theo, phân loại kind
   (tra-loi / theo-doi / nhom / khong-can kèm reason) theo quy tắc viết ở huong-dan/03. Giữ khái niệm của Zalo: "Bạn" là
   chủ tài khoản, người còn lại gọi theo tên; không mặc định ai là "khách".
4. Ghi ba đầu ra (ghi đè file cùng ngày), theo huong-dan/04: ket-qua/bao-cao/YYYY-MM-DD.json + .md (mục F — báo cáo ngày
   gồm overview, conversations, actionItems), ket-qua/de-xuat.json (mục E), ket-qua/YYYY-MM-DD-tong-hop.md
   (threadId/accountId lấy từ dòng "Mã thread"/"Mã tài khoản" đầu file hội thoại; createdAt/generatedAt ISO 8601 có +07:00).

Ràng buộc: KHÔNG gửi tin nhắn, KHÔNG sửa/xoá trong du-lieu/ và huong-dan/, chỉ ghi vào ket-qua/. Không bịa giá, lịch,
thông tin không có trong dữ liệu; chỗ chưa chắc ghi [CẦN XÁC NHẬN: …] ở phần ghi chú. Kết thúc bằng 2–3 dòng tóm tắt.
```

Lưu ý: lịch chỉ chạy khi Claude Cowork đang mở (đóng thì chạy bù ở lần mở sau). Lượt "dữ liệu chưa đổi" chỉ đọc hai file JSON
nhỏ nên rất rẻ; lượt có dữ liệu mới tốn token theo số hội thoại. Ứng dụng vẫn giữ nhịp cập nhật theo chu kỳ trong Cài đặt (mặc định 30 phút, đúng mốc :00/:30) — đây chính là chu kỳ Claude tổng hợp lại khi không có tin mới.
Lần chạy đầu Cowork hỏi quyền ghi file (Write) — duyệt một lần trong mục Scheduled; các lần sau tự chạy.
Hộp thoại 📊 Báo cáo trong ứng dụng đọc `ket-qua/bao-cao/<ngày>.json`; chưa có file thì hiện số liệu của ứng dụng.

## Chạy không phải cấp quyền lại mỗi lượt

Mỗi lượt lịch là một phiên mới, quyền bấm "Cho phép" trong lượt trước KHÔNG được giữ. Cách bền là khai quy tắc cho phép ở
**cấu hình người dùng** `~/.claude/settings.json` (lịch trong Claude desktop chỉ đọc cấp người dùng, không đọc
`.claude/settings.local.json` của dự án). Thêm vào khối `permissions.allow` (giữ các mục đang có; đường dẫn tuyệt đối dùng
tiền tố `//`, có dấu cách vẫn viết thẳng, không cần thoát):

```json
{
  "permissions": {
    "allow": [
      "Read(//Users/<tên-máy>/Documents/Zalo Chat Assistant/**)",
      "Edit(//Users/<tên-máy>/Documents/Zalo Chat Assistant/ket-qua/**)",
      "Agent"
    ]
  }
}
```

- `Edit(...)` bao luôn công cụ Write (quy tắc `Write(...)` riêng bị bỏ qua). Chỉ mở ghi trong `ket-qua/`, không mở `du-lieu/`
  và `huong-dan/` — đúng ràng buộc của lịch.
- `Agent` cho phép gọi subagent (tuần tự từng hội thoại) mà không hỏi.
- Trong prompt của lịch ghi rõ **chỉ dùng Read, Glob, Write, Agent; không dùng Bash** — mọi lệnh Bash vẫn sẽ hỏi quyền.
- Không nên dùng `permissions.defaultMode: "bypassPermissions"` chỉ để lịch chạy trơn: nó tắt hỏi quyền cho MỌI phiên.
  `"defaultMode": "acceptEdits"` (trong `permissions`) cũng được nhưng chỉ tự duyệt ghi file trong thư mục làm việc, vẫn
  phải có `Read(...)` và `Agent` ở trên.
- Sửa xong, đợi lượt kế của lịch (hoặc bấm *Run now* trong mục Scheduled) và kiểm tra lượt đó không dừng hỏi quyền nữa.
