/**
 * Markdown → HTML an toàn. Render Ở MÁY CHỦ rồi lưu `contentHtml`: trang web chỉ việc in ra,
 * không cần thư viện markdown và không có đường cho <script> lọt vào DOM.
 */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img', 'h1', 'h2', 'figure', 'figcaption', 'del', 'ins', 'sup', 'sub',
];

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
    span: ['class'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    // Link ra ngoài mở tab mới và cắt đường "tab-nabbing".
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function renderMarkdown(md) {
  const raw = marked.parse(String(md ?? ''), { async: false });
  return sanitizeHtml(raw, OPTIONS);
}

/** Rút gọn markdown thành đoạn mở đầu thuần văn bản (dùng khi bài không tự đặt excerpt). */
export function autoExcerpt(md, max = 200) {
  const text = sanitizeHtml(marked.parse(String(md ?? ''), { async: false }), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
