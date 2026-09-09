/**
 * Thành phần thương hiệu dùng chung: logo Work Assistant (bong bóng chat + tia),
 * biểu tượng bốn nguồn (Zalo / Telegram / Email / Lark) và biểu tượng hệ điều hành.
 * Toàn bộ là SVG nội tuyến — không tải ảnh ngoài, đổi màu theo token CSS.
 */

export const BRAND_NAME = 'Work Assistant';
export const BRAND_TAGLINE = 'Trợ lý công việc đa nguồn';

let seq = 0;

/** Logo chính — cùng hình với build/icon.svg và thanh trái của ứng dụng. */
export function BrandMark({ size = 38, className = '', title }) {
  // Mỗi lần dựng một id gradient riêng để nhiều logo trên cùng trang không giẫm nhau.
  const id = `wa-g${(seq += 1)}`;
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a66ff" />
          <stop offset="1" stopColor="#22b8ff" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="24" fill={`url(#${id})`} />
      <path
        fill="#fff"
        d="M27 26 h34 a11 11 0 0 1 11 11 v20 a11 11 0 0 1 -11 11 H43 l-11 10 a2.3 2.3 0 0 1 -3.9 -1.7 v-8.6 h-1 a11 11 0 0 1 -11 -11 V37 a11 11 0 0 1 11 -11 z"
      />
      <g fill="#0a66ff">
        <circle cx="33" cy="47" r="3.4" />
        <circle cx="44" cy="47" r="3.4" />
        <circle cx="55" cy="47" r="3.4" />
      </g>
      <path
        fill="#fff"
        stroke="#2f6fed"
        strokeWidth="2.4"
        strokeLinejoin="round"
        d="M70 26 c1.9 8 4.4 10.5 12.4 12.4 c-8 1.9 -10.5 4.4 -12.4 12.4 c-1.9 -8 -4.4 -10.5 -12.4 -12.4 c8 -1.9 10.5 -4.4 12.4 -12.4 z"
      />
    </svg>
  );
}

/** Bốn nguồn dữ liệu + hai năng lực nổi bật — dùng ở hero, section nguồn, footer. */
export const SOURCES = [
  {
    key: 'zalo',
    label: 'Zalo',
    short: 'Zalo cá nhân',
    mode: 'Đọc & trả lời',
    text: 'Kết nối bằng mã QR như Zalo Web. Lưu mọi tin đến/đi, gợi ý câu trả lời ngay cạnh hội thoại.',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    short: 'Nhóm Telegram',
    mode: 'Chỉ đọc',
    text: 'Đọc các nhóm bằng tài khoản cá nhân (API ID/Hash). Không gửi tin, không đánh dấu đã đọc.',
  },
  {
    key: 'email',
    label: 'Email',
    short: 'Hộp thư IMAP',
    mode: 'Chỉ đọc',
    text: 'Gmail, Microsoft 365 hay máy chủ nội bộ — chỉ cần địa chỉ và mật khẩu ứng dụng.',
  },
  {
    key: 'lark',
    label: 'Lark Approval',
    short: 'Phiếu duyệt Lark',
    mode: 'Chỉ đọc',
    text: 'Theo dõi phiếu duyệt Lark/Feishu, đánh dấu phiếu đang chờ chính bạn duyệt.',
  },
];

const SOURCE_GLYPHS = {
  zalo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M9 9h6l-6 4h6" />
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.5 3.6 3.2 10.7c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.2c.3-1.2-.5-1.8-1.1-1.5zM9.4 13.6l8.9-5.6c.4-.3.8 0 .5.3l-7.3 6.6-.3 3.3z" />
    </svg>
  ),
  email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
  lark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.5 6.5l2 2M15.5 15.5l2 2M6.5 17.5l2-2M15.5 8.5l2-2" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  ),
  voice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" />
    </svg>
  ),
};

/** Ô vuông màu + biểu tượng của một nguồn. `kind`: zalo | telegram | email | lark | ai | voice. */
export function SourceIcon({ kind, className = '' }) {
  return (
    <span className={`src-ico ${kind} ${className}`.trim()} aria-hidden="true">
      {SOURCE_GLYPHS[kind] || null}
    </span>
  );
}

/** Viên "Zalo · Telegram · Email · Lark" nhỏ gọn. */
export function SourceChip({ kind, label }) {
  return (
    <span className="chip">
      <SourceIcon kind={kind} />
      {label}
    </span>
  );
}

/** Biểu tượng hệ điều hành cho thẻ tải về (đơn sắc, tô bằng currentColor/fill của CSS). */
export function OsIcon({ platform }) {
  if (platform === 'win32') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5.5 10.5 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
      </svg>
    );
  }
  if (platform === 'linux') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2c-2.5 0-4 2-4 4.5 0 1.3.3 2 .1 3-.5 1.6-2.6 3.4-2.6 6 0 .6.1 1.1.2 1.6-.9.3-1.7 1-1.7 2 0 1.2 1.3 1.9 2.7 1.9.8 0 1.5-.3 2-.7.9.4 2 .7 3.3.7s2.4-.3 3.3-.7c.5.4 1.2.7 2 .7 1.4 0 2.7-.7 2.7-1.9 0-1-.8-1.7-1.7-2 .1-.5.2-1 .2-1.6 0-2.6-2.1-4.4-2.6-6-.2-1 .1-1.7.1-3C16 4 14.5 2 12 2zm-1.5 4.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm3 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM12 9l1.8 1.2L12 11.5l-1.8-1.3z" />
      </svg>
    );
  }
  // macOS
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z" />
    </svg>
  );
}
