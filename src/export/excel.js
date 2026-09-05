/**
 * Xuất Excel: sheet "Tổng quan" + MỖI HỘI THOẠI MỘT SHEET.
 *
 * Dùng WorkbookWriter (streaming) của exceljs: ghi dòng nào đẩy ra đĩa dòng đó, không giữ cả workbook trong
 * RAM — cần thiết khi người dùng có hàng nghìn hội thoại. Sheet Tổng quan được tính bằng SQL rồi ghi và
 * commit TRƯỚC khi ghi các sheet hội thoại (streaming writer ghi tuần tự từng sheet).
 *
 * Giới hạn Excel cần biết: tên sheet ≤ 31 ký tự và không trùng (xử lý ở uniqueSheetName); file nhiều
 * trăm sheet mở chậm trên Excel — người dùng nên lọc theo khoảng ngày / chỉ hội thoại chưa trả lời.
 */
import path from 'node:path';
import ExcelJS from 'exceljs';
import { TYPE_LABEL_VI, attachmentsToText } from '../zalo/normalize.js';
import { formatVn, uniqueSheetName, parseAttachments, stampVn, waitingHoursOf } from './common.js';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.commit();
}

export async function exportExcel({ db, selection, from, to, outDir, accountsById, waitingHours = 2 }) {
  const filePath = path.join(outDir, `zalo-hoi-thoai-${stampVn()}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  wb.creator = 'Zalo Chat Assistant';
  wb.created = new Date();

  const used = new Set();
  const overviewName = uniqueSheetName('Tổng quan', used);

  // 1) Tính trước thống kê từng hội thoại (SQL, rẻ) để ghi sheet Tổng quan xong rồi mới ghi sheet chi tiết.
  const plan = selection.map((c, i) => {
    const s = db.conversationRangeStats(c.account_id, c.thread_id, from, to);
    const sheetName = uniqueSheetName(c.name || (c.is_group ? `Nhóm ${c.thread_id}` : `Khách ${c.thread_id}`), used);
    return { c, s, sheetName, index: i + 1 };
  });

  const overview = wb.addWorksheet(overviewName, { views: [{ state: 'frozen', ySplit: 1 }] });
  overview.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Hội thoại', key: 'name', width: 32 },
    { header: 'Loại', key: 'kind', width: 8 },
    { header: 'SĐT', key: 'phone', width: 14 },
    { header: 'Tài khoản Zalo', key: 'account', width: 22 },
    { header: 'Số tin (trong khoảng)', key: 'total', width: 12 },
    { header: 'Tin người kia', key: 'inbound', width: 12 },
    { header: 'Tin của bạn', key: 'outbound', width: 10 },
    { header: 'Tin đầu', key: 'first', width: 20 },
    { header: 'Tin cuối', key: 'last', width: 20 },
    { header: 'Ai nhắn cuối', key: 'lastBy', width: 12 },
    { header: 'Chưa trả lời', key: 'waiting', width: 16 },
    { header: 'Nội dung tin cuối', key: 'preview', width: 60 },
    { header: 'Sheet chi tiết', key: 'sheet', width: 32 },
    { header: 'Mã thread', key: 'thread', width: 22 },
  ];
  styleHeader(overview);

  for (const { c, s, sheetName, index } of plan) {
    const wh = waitingHoursOf(c);
    overview.addRow({
      stt: index,
      name: c.name || '(chưa rõ tên)',
      kind: c.is_group ? 'Nhóm' : '1-1',
      phone: c.phone || '',
      account: accountsById[c.account_id]?.display_name || c.account_id,
      total: s?.total ?? 0,
      inbound: s?.inbound ?? 0,
      outbound: s?.outbound ?? 0,
      first: formatVn(s?.first_at),
      last: formatVn(s?.last_at),
      lastBy: c.last_message_outbound === 1 ? 'Bạn' : (c.last_message_sender || c.name || 'Người kia'),
      waiting: c.is_group ? '— (nhóm)' : c.last_message_outbound === 0
        ? (wh >= waitingHours ? `CÓ — quá ${Math.floor(wh)}h` : 'Có')
        : 'Không',
      preview: c.last_message_preview || '',
      sheet: sheetName,
      thread: c.thread_id,
    }).commit();
  }
  overview.commit();

  // 2) Mỗi hội thoại một sheet.
  let totalMessages = 0;
  for (const { c, sheetName } of plan) {
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Thời gian', key: 'time', width: 20 },
      { header: 'Chiều', key: 'dir', width: 8 },
      { header: 'Người gửi', key: 'sender', width: 22 },
      { header: 'Loại', key: 'type', width: 10 },
      { header: 'Nội dung', key: 'text', width: 80, style: { alignment: { wrapText: true, vertical: 'top' } } },
      { header: 'Đính kèm', key: 'att', width: 45 },
      { header: 'Trả lời tin', key: 'quote', width: 30 },
      { header: 'Ghi chú', key: 'note', width: 12 },
      { header: 'Mã tin', key: 'id', width: 20 },
    ];
    styleHeader(ws);

    for (const m of db.iterateMessages(c.account_id, c.thread_id, from, to)) {
      ws.addRow({
        time: formatVn(m.event_time),
        dir: m.is_outbound ? 'Bạn' : 'Người kia',
        sender: m.sender_name || (m.is_outbound ? 'Tôi' : c.name || m.sender_id || ''),
        type: TYPE_LABEL_VI[m.type] ?? m.type,
        text: m.text ?? '',
        att: attachmentsToText(parseAttachments(m.attachments_json)),
        quote: m.quote_text ?? '',
        note: m.recalled ? 'Đã thu hồi' : '',
        id: m.zalo_msg_id ?? '',
      }).commit();
      totalMessages++;
    }
    ws.commit();
  }

  await wb.commit();
  return { filePath, conversations: plan.length, messages: totalMessages };
}
