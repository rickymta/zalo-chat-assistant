/**
 * Gói Markdown cho Claude Cowork — định dạng KHUYẾN NGHỊ để tổng hợp/đề xuất phản hồi.
 *
 * Mỗi hội thoại một file `.md` (Cowork đọc thẳng, nạp từng hội thoại theo nhu cầu), kèm:
 *  - 00-INDEX.md: bảng mọi hội thoại trong gói (tên, SĐT, số tin, tin cuối, đang chờ trả lời?)
 *  - tong-hop.csv: cùng nội dung ở dạng bảng (cho Excel/Numbers/Sheets)
 *  - README-DU-LIEU.md: mô tả gói này (phạm vi, quy ước, cách đọc) — sinh tự động
 *  - huong-dan/: bản sao bộ tài liệu `cowork/` để gói TỰ ĐỦ — chỉ cần trỏ Cowork vào một thư mục
 *  - tin-nhan.jsonl (tuỳ chọn): mọi tin ở dạng máy đọc
 */
import fs from 'node:fs';
import path from 'node:path';
import { TYPE_LABEL_VI } from '../zalo/normalize.js';
import { formatVn, slugify, parseAttachments, writeText, ensureDir, waitingHoursOf } from './common.js';

function mdEscapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function csvCell(s) {
  const v = String(s ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function renderAttachments(list) {
  return list.map((a) => {
    const label = TYPE_LABEL_VI[a.type] ?? a.type;
    if (a.url) return `[${label}${a.name && a.type !== 'sticker' ? `: ${a.name}` : ''}](${a.url})`;
    return `[${label}${a.name && a.type !== 'sticker' ? `: ${a.name}` : ''}]`;
  }).join(' ');
}

function renderMessage(m, conv) {
  // 1-1: KHÁCH / MÌNH. Nhóm: THÀNH VIÊN (Tên) / MÌNH — trong nhóm người gửi đổi liên tục, tên là bắt buộc.
  const who = m.is_outbound ? 'MÌNH' : (conv.is_group ? 'THÀNH VIÊN' : 'KHÁCH');
  const name = !m.is_outbound && m.sender_name && (conv.is_group || m.sender_name !== conv.name) ? ` (${m.sender_name})` : '';
  const parts = [];
  if (m.recalled) parts.push('_(tin này đã bị thu hồi)_');
  if (m.quote_text) parts.push(`> trả lời: ${m.quote_text.replace(/\r?\n/g, ' ').slice(0, 200)}`);
  if (m.text && m.text.trim()) parts.push(m.text.trim().replace(/\r?\n/g, '\n  '));
  const att = renderAttachments(parseAttachments(m.attachments_json));
  if (att) parts.push(att);
  if (!parts.length) parts.push(`[${TYPE_LABEL_VI[m.type] ?? m.type}]`);
  return `- **[${formatVn(m.event_time)}] ${who}${name}:** ${parts.join('\n  ')}`;
}

function copyDirFlat(src, dest, { exts = ['.md', '.txt', '.csv'] } = {}) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dest);
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) { n += copyDirFlat(from, to, { exts }); continue; }
    if (!exts.includes(path.extname(entry.name).toLowerCase())) continue;
    fs.copyFileSync(from, to);
    n++;
  }
  return n;
}

export async function exportMarkdown({
  db, selection, from, to, outDir, accountsById, coworkDir, includeJsonl = false, waitingHours = 2, workspaceMode = false,
}) {
  const convDir = ensureDir(path.join(outDir, 'hoi-thoai'));
  const now = Date.now();
  const width = Math.max(3, String(selection.length).length);   // 001-, 002-… để Finder sắp đúng thứ tự
  const indexRows = [];
  const fileMap = {};   // "hoi-thoai/001-....md" → { accountId, threadId, name } — để ứng dụng gắn gợi ý của Claude vào đúng hội thoại
  let totalMessages = 0;
  let waitingCount = 0;
  let jsonl = null;
  if (includeJsonl) jsonl = fs.createWriteStream(path.join(outDir, 'tin-nhan.jsonl'), { encoding: 'utf8' });

  selection.forEach((c, i) => {
    const stats = db.conversationRangeStats(c.account_id, c.thread_id, from, to);
    const idx = String(i + 1).padStart(width, '0');
    const fileName = `${idx}-${slugify(c.name || c.thread_id)}.md`;
    const account = accountsById[c.account_id];
    const wh = waitingHoursOf(c, now);
    const waiting = c.last_message_outbound === 0 && !c.is_group;
    if (waiting) waitingCount++;

    const lines = [];
    lines.push(`# Hội thoại: ${c.name || '(chưa rõ tên)'}`);
    lines.push('');
    lines.push(`- Loại: ${c.is_group ? 'Nhóm' : '1-1'} · Mã thread: \`${c.thread_id}\` · Mã tài khoản: \`${c.account_id}\``);
    lines.push(`- SĐT khách: ${c.phone || 'không có'}`);
    lines.push(`- Tài khoản Zalo của mình: ${account?.display_name || c.account_id}${account?.phone ? ` (${account.phone})` : ''}`);
    lines.push(`- Khoảng thời gian trong gói: ${formatVn(stats?.first_at)} → ${formatVn(stats?.last_at)}`);
    const other = c.is_group ? 'thành viên' : 'khách';
    lines.push(`- Số tin trong gói: ${stats?.total ?? 0} (${other} ${stats?.inbound ?? 0} / mình ${stats?.outbound ?? 0}) · Tổng đã lưu: ${c.message_count}`);
    lines.push(`- Tin cuối: ${formatVn(c.last_message_at)} do ${c.last_message_outbound === 1 ? 'MÌNH' : (c.is_group ? `THÀNH VIÊN ${c.last_message_sender || ''}`.trim() : 'KHÁCH')} gửi`);
    if (c.is_group) {
      lines.push(`- Trạng thái: NHÓM CHAT — không áp dụng "chờ trả lời"; tin cuối do ${c.last_message_outbound === 1 ? 'MÌNH' : (c.last_message_sender || 'thành viên')} gửi`);
    } else {
      lines.push(
        waiting
          ? `- **Trạng thái: ĐANG CHỜ TRẢ LỜI** (khách nhắn cuối, đã ${wh.toFixed(1)} giờ${wh >= waitingHours ? ' — QUÁ HẠN' : ''})`
          : '- Trạng thái: Đã trả lời (tin cuối là của mình)',
      );
    }
    if (c.note) lines.push(`- Ghi chú: ${c.note}`);
    lines.push('');
    lines.push('## Tin nhắn (cũ → mới)');
    lines.push('');

    for (const m of db.iterateMessages(c.account_id, c.thread_id, from, to)) {
      lines.push(renderMessage(m, c));
      totalMessages++;
      if (jsonl) {
        jsonl.write(JSON.stringify({
          account_id: m.account_id, thread_id: m.thread_id, conversation: c.name ?? null, phone: c.phone ?? null,
          is_group: !!c.is_group, msg_id: m.zalo_msg_id, time: formatVn(m.event_time), time_ms: m.event_time,
          direction: m.is_outbound ? 'out' : 'in', sender: m.sender_name, type: m.type, text: m.text,
          attachments: parseAttachments(m.attachments_json), quote: m.quote_text, recalled: !!m.recalled,
        }) + '\n');
      }
    }
    lines.push('');
    writeText(path.join(convDir, fileName), lines.join('\n'));
    fileMap[`hoi-thoai/${fileName}`] = { accountId: c.account_id, threadId: c.thread_id, name: c.name ?? null, isGroup: !!c.is_group };

    indexRows.push({
      idx, file: `hoi-thoai/${fileName}`, name: c.name || '(chưa rõ tên)', kind: c.is_group ? 'Nhóm' : '1-1',
      phone: c.phone || '', account: account?.display_name || c.account_id, total: stats?.total ?? 0,
      inbound: stats?.inbound ?? 0, outbound: stats?.outbound ?? 0, last: formatVn(c.last_message_at),
      lastBy: c.last_message_outbound === 1 ? 'Mình' : (c.is_group ? (c.last_message_sender || 'Thành viên') : 'Khách'),
      waiting: c.is_group ? '— (nhóm)' : waiting ? (wh >= waitingHours ? `CÓ (quá ${Math.floor(wh)}h)` : 'Có') : 'Không',
      preview: c.last_message_preview || '', thread: c.thread_id,
    });
  });
  if (jsonl) await new Promise((r) => jsonl.end(r));

  writeText(path.join(outDir, '.map.json'), JSON.stringify(fileMap, null, 2));

  // 00-INDEX.md
  const idx = [];
  idx.push('# Danh mục hội thoại trong gói');
  idx.push('');
  idx.push(`Tạo lúc: ${formatVn(now)} · ${selection.length} hội thoại · ${totalMessages} tin · **${waitingCount} hội thoại đang chờ trả lời**`);
  idx.push(`Phạm vi thời gian: ${from ? formatVn(from) : 'từ đầu'} → ${to ? formatVn(to) : 'đến nay'}`);
  idx.push('');
  idx.push('Mở file trong cột "File" để đọc toàn bộ tin nhắn của hội thoại đó. Cột "Chờ trả lời" = tin cuối do KHÁCH gửi (chỉ với 1-1; nhóm ghi "— (nhóm)").');
  idx.push('');
  idx.push('| # | Hội thoại | Loại | SĐT | Tin | Khách | Mình | Tin cuối | Ai nhắn cuối | Chờ trả lời | Nội dung tin cuối | File |');
  idx.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of indexRows) {
    idx.push(`| ${r.idx} | ${mdEscapeCell(r.name)} | ${r.kind} | ${r.phone} | ${r.total} | ${r.inbound} | ${r.outbound} | ${r.last} | ${r.lastBy} | ${r.waiting} | ${mdEscapeCell(r.preview).slice(0, 80)} | [${r.file}](${r.file}) |`);
  }
  idx.push('');
  writeText(path.join(outDir, '00-INDEX.md'), idx.join('\n'));

  // tong-hop.csv
  const csv = ['stt,hoi_thoai,loai,sdt,tai_khoan,so_tin,tin_khach,tin_minh,tin_cuoi,ai_nhan_cuoi,cho_tra_loi,noi_dung_tin_cuoi,ma_thread,file'];
  for (const r of indexRows) {
    csv.push([r.idx, r.name, r.kind, r.phone, r.account, r.total, r.inbound, r.outbound, r.last, r.lastBy, r.waiting, r.preview, r.thread, r.file].map(csvCell).join(','));
  }
  writeText(path.join(outDir, 'tong-hop.csv'), '﻿' + csv.join('\n'));

  // huong-dan/ — bản sao tài liệu Cowork để gói tự đủ
  const copied = coworkDir ? copyDirFlat(coworkDir, path.join(outDir, 'huong-dan')) : 0;

  // README-DU-LIEU.md
  const readme = [];
  readme.push(workspaceMode ? '# Dữ liệu tin nhắn Zalo (du-lieu/) — đọc file này trước' : '# Gói dữ liệu tin nhắn Zalo — đọc file này trước');
  readme.push('');
  readme.push(`- Tạo lúc: **${formatVn(now)}** bởi Zalo Chat Assistant`);
  readme.push(`- Phạm vi: ${from ? formatVn(from) : 'từ đầu'} → ${to ? formatVn(to) : 'đến nay'}`);
  readme.push(`- Quy mô: **${selection.length} hội thoại**, **${totalMessages} tin nhắn**, **${waitingCount} hội thoại đang chờ trả lời**`);
  readme.push(`- Tài khoản Zalo: ${[...new Set(selection.map((c) => accountsById[c.account_id]?.display_name || c.account_id))].join(', ') || '(không có)'}`);
  readme.push('');
  readme.push('## Có gì trong gói');
  readme.push('');
  readme.push('| Đường dẫn | Nội dung |');
  readme.push('|---|---|');
  readme.push('| `00-INDEX.md` | Danh mục mọi hội thoại: tên, SĐT, số tin, tin cuối, **đang chờ trả lời?** — đọc để chọn hội thoại cần xử lý |');
  readme.push('| `hoi-thoai/NNN-<ten>.md` | Toàn bộ tin nhắn của MỘT hội thoại, cũ → mới, có nhãn KHÁCH / MÌNH |');
  readme.push('| `tong-hop.csv` | Bảng như 00-INDEX ở dạng CSV (UTF-8 BOM, mở được bằng Excel) |');
  if (includeJsonl) readme.push('| `tin-nhan.jsonl` | Mọi tin nhắn, mỗi dòng một JSON — cho script/phân tích |');
  if (copied) readme.push('| `huong-dan/` | Bộ chỉ dẫn cho Claude Cowork: vai trò, quy trình tổng hợp, quy tắc đề xuất phản hồi, thông tin MedDental. **Bắt đầu từ `huong-dan/00-chi-dan-cho-claude.md`** |');
  readme.push('');
  readme.push('## Quy ước trong file hội thoại');
  readme.push('');
  readme.push('- `KHÁCH` = người đối thoại gửi; `MÌNH` = chủ tài khoản Zalo (tư vấn viên) gửi — kể cả gửi từ điện thoại.');
  readme.push('- Trong NHÓM chat: `THÀNH VIÊN (Tên)` = một thành viên gửi; `MÌNH` = chủ tài khoản. Nhóm KHÔNG áp dụng "đang chờ trả lời" — hãy tổng hợp theo chủ đề, việc cần làm và câu hỏi hướng tới mình (xem huong-dan/02).');
  readme.push('- Lịch sử NHÓM có thể gồm tin cũ hơn ngày cài ứng dụng (Zalo cho lấy vài trăm tin gần nhất mỗi nhóm); hội thoại 1-1 thì không.');
  readme.push('- Thời gian theo giờ Việt Nam, định dạng `dd/MM/yyyy HH:mm:ss`.');
  readme.push('- Ảnh/tệp/sticker chỉ có LIÊN KẾT (không tải về). Liên kết Zalo có thể hết hạn; nội dung ảnh KHÔNG đọc được từ gói này.');
  readme.push('- "ĐANG CHỜ TRẢ LỜI" = tin cuối cùng là của KHÁCH. "QUÁ HẠN" = đã quá số giờ cấu hình trong ứng dụng.');
  readme.push('- Dữ liệu thu thập từ lúc ứng dụng bắt đầu chạy (cộng phần tin bỏ lỡ mà Zalo gửi bù khi nối lại). Tin nhắn TRƯỚC ngày đăng nhập lần đầu KHÔNG có trong gói.');
  readme.push('');
  readme.push('## Cách dùng với Claude Cowork');
  readme.push('');
  if (workspaceMode) {
    readme.push('1. Claude Cowork đã/sẽ được trỏ vào thư mục CHA của thư mục này (`Zalo Chat Assistant`, nơi có `CLAUDE.md` và `huong-dan/`).');
    readme.push('2. Nhắn: *"Đọc `huong-dan/00-chi-dan-cho-claude.md` rồi tổng hợp tất cả hội thoại trong du-lieu/ và đề xuất phản hồi cho từng hội thoại."* Dữ liệu ở `du-lieu/`, kết quả ghi vào `ket-qua/`.');
  } else {
    readme.push('1. Mở Claude Cowork, chọn thư mục này làm thư mục làm việc.');
    readme.push('2. Nhắn: *"Đọc `huong-dan/00-chi-dan-cho-claude.md` rồi tổng hợp tất cả hội thoại trong du-lieu/ và đề xuất phản hồi cho từng hội thoại."*');
  }
  readme.push('3. Kết quả (bản tổng hợp + đề xuất phản hồi) là ĐỀ XUẤT — tư vấn viên đọc, sửa rồi tự gửi trên Zalo. Ứng dụng này không gửi tin.');
  readme.push('');
  writeText(path.join(outDir, 'README-DU-LIEU.md'), readme.join('\n'));

  return {
    dir: outDir,
    conversations: selection.length,
    messages: totalMessages,
    waiting: waitingCount,
    files: ['README-DU-LIEU.md', '00-INDEX.md', 'tong-hop.csv', 'hoi-thoai/', ...(includeJsonl ? ['tin-nhan.jsonl'] : []), ...(copied ? ['huong-dan/'] : [])],
  };
}
