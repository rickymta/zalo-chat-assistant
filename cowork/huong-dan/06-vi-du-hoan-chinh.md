# 06 · Ví dụ hoàn chỉnh: từ file hội thoại đến phiếu đề xuất

## Đầu vào — `du-lieu/hoi-thoai/006-vu-ngoc-mai.md` (rút gọn)

```
# Hội thoại: Vũ Ngọc Mai
- Loại: 1-1 · Mã thread: `1006`
- SĐT khách: không có
- Tin cuối: 04/09/2026 14:05:00 do KHÁCH gửi
- **Trạng thái: ĐANG CHỜ TRẢ LỜI** (khách nhắn cuối, đã 6.5 giờ — QUÁ HẠN)

## Tin nhắn (cũ → mới)
- **[03/09/2026 09:00:00] Vũ Ngọc Mai:** Nhổ răng khôn có đau không ạ, em sợ quá
- **[03/09/2026 09:12:00] Bạn:** Dạ có gây tê nên trong lúc nhổ không đau ạ; sau đó ê nhẹ vài ngày. Bên em dùng máy Piezotome ít sang chấn. Chị Mai muốn đặt lịch khám để bác sĩ chụp phim đánh giá không ạ?
- **[03/09/2026 09:20:00] Vũ Ngọc Mai:** Để em sắp xếp rồi báo lại
- **[04/09/2026 13:50:00] Vũ Ngọc Mai:** Chị ơi em nhổ ở chỗ khác hôm qua rồi, giờ đau nhiều quá, má sưng, có sao không ạ
- **[04/09/2026 14:05:00] Vũ Ngọc Mai:** [Ảnh: IMG_2231.jpg](https://…)
```

## Cách đọc

- Tin "Bạn" cuối lúc 03/09 09:12 → hai tin mới của người kia (13:50 và 14:05 ngày 04/09) chưa được trả lời.
- Nhu cầu đổi từ "hỏi trước khi nhổ" sang **theo dõi sau nhổ răng ở nơi khác**, có **đau nhiều + sưng** ⇒ dấu hiệu
  cần xử lý sớm (file 03 mục 4) ⇒ **P1**, nên gọi điện.
- Ảnh không đọc được ⇒ `[CẦN XÁC NHẬN: nội dung ảnh]`.
- Cách xưng hô: khách xưng "em", gọi tư vấn viên "chị"; tư vấn viên trước đó gọi khách "chị Mai" — hai bên đều dùng
  "chị". Giữ cách tư vấn viên đã dùng: gọi khách "chị Mai", tư vấn viên xưng "em".
- Không kết luận "khách bị viêm ổ răng"; chỉ mô tả dấu hiệu cần khám.

## Đầu ra — phiếu trong `ket-qua/2026-09-04-tong-hop.md`

```
## [P1] Vũ Ngọc Mai — du-lieu/hoi-thoai/006-vu-ngoc-mai.md
⚠️ Nên GỌI ĐIỆN thay vì nhắn (khách không để lại SĐT trong Zalo — hỏi số trong tin).

**Tóm tắt:** Ngày 03/09 khách hỏi nhổ răng khôn có đau không, tư vấn viên đã tư vấn và mời khám; khách nói sẽ báo lại.
Ngày 04/09 khách cho biết đã nhổ ở nơi khác hôm trước, hiện đau nhiều và sưng má, gửi kèm 1 ảnh, hỏi "có sao không".
Chưa được trả lời 6,5 giờ.

**Khách cần gì:** trấn an + hướng dẫn xử lý đau/sưng sau nhổ răng khôn (làm ở nơi khác).
**Giai đoạn:** sau điều trị (nơi khác), chưa từng khám tại MedDental. **Cảm xúc:** lo lắng, khẩn.
**Chưa được trả lời:** "giờ đau nhiều quá, má sưng, có sao không ạ" + ảnh.
**Việc đã hứa:** không có. **Thông tin đã có:** nhổ hôm 03/09; không có SĐT.

**Đề xuất phản hồi (dán vào Zalo):**
Chị Mai ơi, em xin lỗi vì trả lời chị muộn.
Sau nhổ răng khôn 1–2 ngày đầu thường sẽ ê và hơi sưng, nhưng đau nhiều kèm sưng má thì chị nên được bác sĩ kiểm tra sớm để xem ổ răng có ổn không, chị đừng tự uống thêm thuốc ngoài đơn nhé.
Chị có thể qua cơ sở MedDental gần nhất trong hôm nay để bác sĩ kiểm tra (các cơ sở mở đến 17h), hoặc gọi hotline 0985 018 688 để được hướng dẫn ngay. Nếu chị sốt, chảy máu không cầm hay khó nuốt thì đến cơ sở y tế gần nhất ngay ạ.
Chị cho em xin số điện thoại để em gọi hỗ trợ chị nhanh hơn được không ạ?

**Ghi chú cho tư vấn viên:** [CẦN XÁC NHẬN: nội dung ảnh — nếu ảnh cho thấy chảy máu/sưng lớn thì ưu tiên gọi ngay];
khách chưa phải khách MedDental, kiểm tra chính sách khám sau nhổ răng nơi khác trước khi hứa miễn phí khám.
**Hành động tiếp:** gọi điện ngay khi có số; báo cơ sở gần khách chuẩn bị tiếp nhận.
```

## Vì sao phiếu này đạt

- Trả lời thẳng câu "có sao không" mà không chẩn đoán; nêu dấu hiệu cần đi cấp cứu; đưa hai cách liên hệ có trong file 05.
- Không nhắc giá, không nhắc nơi khách đã nhổ, không hứa "sẽ hết đau".
- Giữ cách xưng hô, có lời xin lỗi vì trả lời muộn, kết bằng một câu hỏi để tiếp tục.
- Mọi điều bạn không chắc nằm ở Ghi chú, không lọt vào tin gửi khách.
