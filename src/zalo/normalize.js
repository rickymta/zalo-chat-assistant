/**
 * Chuẩn hoá một tin của zca-js (giao thức KHÔNG chính thức) về dòng lưu trong SQLite.
 *
 * Mọi trường đều đọc phòng thủ: Zalo đổi tên trường thì mất một phần nội dung chứ KHÔNG được ném lỗi làm
 * chết listener. Bảng `msgType` lấy từ source zca-js, giống bảng đang chạy ở CRM (zalo-personal-bridge).
 */

const TYPE_BY_MSGTYPE = {
  'chat.photo': 'image',
  'chat.gif': 'gif',
  'chat.sticker': 'sticker',
  'chat.doodle': 'image',
  'chat.video.msg': 'video',
  'chat.voice': 'audio',
  'chat.link': 'link',
  'chat.recommended': 'link',
  'chat.location.new': 'location',
  'share.file': 'file',
};

export const TYPE_LABEL_VI = {
  text: 'Văn bản',
  image: 'Ảnh',
  gif: 'Ảnh động',
  sticker: 'Sticker',
  video: 'Video',
  audio: 'Ghi âm',
  link: 'Liên kết',
  location: 'Vị trí',
  file: 'Tệp',
  other: 'Khác',
};

function mapType(msgType, content) {
  const mapped = typeof msgType === 'string' ? TYPE_BY_MSGTYPE[msgType] : undefined;
  if (mapped) return mapped;
  if (content && typeof content === 'object') {
    if (content.catId !== undefined) return 'sticker';
    if (content.href || content.url) return 'file';
    return 'other';
  }
  return 'text';
}

function str(v) {
  return v === undefined || v === null ? null : String(v);
}

/**
 * @returns {null | {
 *   threadId: string, isGroup: boolean, zaloMsgId: string|null, cliMsgId: string|null,
 *   isOutbound: boolean, senderId: string|null, senderName: string|null,
 *   type: string, text: string|null, attachments: Array<{type:string,url?:string|null,name?:string|null,id?:string}>,
 *   quoteText: string|null, eventTime: number, raw: string }}
 */
export function normalizeMessage(msg) {
  const data = msg?.data ?? {};
  const threadId = str(msg?.threadId ?? data?.uidFrom);
  if (!threadId) return null;

  const isGroup = msg?.type === 1 || msg?.isGroup === true;
  const isOutbound = msg?.isSelf === true || data?.isSelf === true;
  const content = data?.content;

  let type = 'text';
  let text = null;
  const attachments = [];

  if (typeof content === 'string') {
    text = content;
  } else if (content && typeof content === 'object') {
    type = mapType(data?.msgType, content);
    const href = content.href ?? content.url ?? null;
    const title = content.title ?? content.fileName ?? null;
    const description = content.description ?? null;

    if (type === 'sticker') {
      attachments.push({ type, url: null, name: '[Sticker]', id: str(content.id ?? content.stickerId) });
    } else if (href) {
      attachments.push({ type, url: String(href), name: title ? String(title) : null, thumb: content.thumb ? String(content.thumb) : null });
    }

    // Liên kết/vị trí/thẻ: gom tiêu đề + mô tả vào text để người đọc (và Claude) thấy được nội dung.
    if (type === 'link' || type === 'location' || type === 'other') {
      text = [title, description].filter((s) => typeof s === 'string' && s.trim()).join(' — ') || null;
      if (type === 'link' && href && !text?.includes(String(href))) text = text ? `${text}\n${href}` : String(href);
    } else if (type === 'file' && title) {
      text = null; // tên tệp đã nằm ở đính kèm
    }
  } else if (content !== undefined && content !== null) {
    text = String(content);
  }

  // Tin thu hồi / tin hệ thống đôi khi tới với msgType đặc biệt và content rỗng — vẫn lưu để giữ dòng thời gian.
  const quoteText = typeof data?.quote?.msg === 'string' && data.quote.msg.trim() ? data.quote.msg : null;

  let raw = '';
  try { raw = JSON.stringify(msg).slice(0, 8000); } catch { raw = ''; }

  const ts = Number(data?.ts);
  return {
    threadId,
    isGroup,
    zaloMsgId: str(data?.msgId),
    cliMsgId: str(data?.cliMsgId),
    isOutbound,
    senderId: str(data?.uidFrom),
    senderName: typeof data?.dName === 'string' && data.dName.trim() ? data.dName.trim() : null,
    type,
    text,
    attachments,
    quoteText,
    eventTime: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    raw,
  };
}

/** Dòng tóm tắt ngắn cho danh sách hội thoại. */
export function previewOf({ type, text, attachments }) {
  if (text && text.trim()) return text.trim().replace(/\s+/g, ' ').slice(0, 140);
  if (attachments?.length) {
    const a = attachments[0];
    return `[${TYPE_LABEL_VI[a.type] ?? a.type}${a.name && a.type !== 'sticker' ? `: ${a.name}` : ''}]`;
  }
  return `[${TYPE_LABEL_VI[type] ?? type}]`;
}

/** Diễn giải đính kèm thành văn bản một dòng (dùng cho Excel/Markdown). */
export function attachmentsToText(attachments) {
  if (!attachments?.length) return '';
  return attachments
    .map((a) => {
      const label = TYPE_LABEL_VI[a.type] ?? a.type;
      if (a.url) return `[${label}${a.name ? `: ${a.name}` : ''}] ${a.url}`;
      return `[${label}${a.name && a.type !== 'sticker' ? `: ${a.name}` : ''}]`;
    })
    .join('\n');
}
