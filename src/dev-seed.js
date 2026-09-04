/**
 * Gieo dữ liệu MẪU để xem giao diện và thử xuất mà không cần đăng nhập Zalo thật.
 * Chỉ dùng khi phát triển: ghi vào một CSDL riêng (ZCA_DATA_DIR) — đừng chạy trên dữ liệu thật.
 */
import { ensureDirs, DB_PATH, DATA_DIR } from './config.js';
import { openDb } from './db.js';
import { previewOf } from './zalo/normalize.js';

ensureDirs();
const db = openDb(DB_PATH);
const acc = 'demo-account-1';
db.upsertAccount({ id: acc, displayName: 'Tư vấn viên Demo', phone: '0985018688', status: 'disconnected' });

const customers = [
  ['1001', 'Nguyễn Thị Lan', '0912000001'], ['1002', 'Trần Văn Hùng', '0912000002'], ['1003', 'Phạm Minh Anh', null],
  ['1004', 'Lê Thu Hà', '0912000004'], ['1005', 'Hoàng Đức Long', '0912000005'], ['1006', 'Vũ Ngọc Mai', null],
  ['1007', 'Đỗ Quang Huy', '0912000007'], ['1008', 'Bùi Thanh Tâm', '0912000008'],
];
const scripts = [
  [['in', 'Chào shop, em muốn hỏi niềng răng trong suốt giá bao nhiêu ạ?'], ['out', 'Chào chị Lan, MedDental có Invisalign và mắc cài. Chị cho em xin ảnh răng để bác sĩ tư vấn sơ bộ nhé.'], ['in', 'Dạ đây ạ', 'image'], ['in', 'Em ở Thanh Xuân thì đến cơ sở nào gần ạ?']],
  [['in', 'Anh đặt lịch cạo vôi răng thứ 7 này được không?'], ['out', 'Dạ được ạ, anh Hùng muốn khung giờ nào? Sáng 8h–12h hoặc chiều 13h30–17h30.'], ['in', 'Sáng 9h nhé'], ['out', 'Em đã ghi nhận lịch 9h sáng thứ 7 tại MedDental Khuất Duy Tiến. Hẹn gặp anh!']],
  [['in', 'Răng em bị ê buốt khi uống lạnh, có sao không?'], ['in', 'Em có nên đi khám không ạ']],
  [['out', 'Chị Hà ơi, mai 15h chị có lịch tái khám Implant nhé.'], ['in', 'Ok em, chị nhớ rồi'], ['in', 'Sticker', 'sticker']],
  [['in', 'Cho anh hỏi bọc răng sứ bao nhiêu tiền 1 cái?'], ['out', 'Dạ giá tham khảo tuỳ loại sứ, anh Long cho em biết răng cần bọc ở vị trí nào để em báo cụ thể ạ.'], ['in', 'Răng cửa, 2 cái'], ['in', 'Có bảo hành không em?']],
  [['in', 'Nhổ răng khôn có đau không ạ, em sợ quá'], ['out', 'Dạ có gây tê nên trong lúc nhổ không đau ạ; sau đó ê nhẹ vài ngày. Bên em dùng máy Piezotome ít sang chấn. Chị Mai muốn đặt lịch khám để bác sĩ chụp phim đánh giá không ạ?'], ['in', 'Để em sắp xếp rồi báo lại']],
  [['in', 'Địa chỉ cơ sở Hạ Long ở đâu?'], ['out', 'Dạ A9-02 KĐT Monbay, Hạ Long, Quảng Ninh ạ. Mở cửa 8h–17h.'], ['in', 'Cảm ơn em']],
  [['in', 'Bé nhà chị 7 tuổi răng mọc lệch, có niềng sớm được không?']],
];

const now = Date.now();
let msgId = 900000;
customers.forEach(([uid, name, phone], i) => {
  const base = now - (i + 1) * 3600000 * 5;
  scripts[i].forEach(([dir, text, type = 'text'], j) => {
    const t = base + j * 600000;
    const attachments = type === 'image' ? [{ type: 'image', url: 'https://example.invalid/anh.jpg', name: 'anh.jpg' }]
      : type === 'sticker' ? [{ type: 'sticker', url: null, name: '[Sticker]' }] : [];
    db.insertMessage({
      account_id: acc, thread_id: uid, is_group: false, zalo_msg_id: String(msgId++), cli_msg_id: null,
      is_outbound: dir === 'out' ? 1 : 0, sender_id: dir === 'out' ? acc : uid,
      sender_name: dir === 'out' ? 'Tư vấn viên Demo' : name, type, text: type === 'text' ? text : null,
      attachments_json: attachments.length ? JSON.stringify(attachments) : null, quote_text: null,
      event_time: t, source: 'demo', raw_json: null, created_at: now,
      conv_name: name, conv_avatar: null, conv_phone: phone,
      preview: previewOf({ type, text: type === 'text' ? text : null, attachments }),
    });
  });
});
console.log(`Đã gieo dữ liệu mẫu vào ${DATA_DIR}:`, db.stats());
db.close();
