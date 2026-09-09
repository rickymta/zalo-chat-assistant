/**
 * Dựng HTML tối giản chứa thẻ Open Graph / Twitter Card THEO TỪNG TRANG cho các bot xem
 * trước liên kết (Zalo, Telegram, Lark, Facebook, Slack…). Web là SPA (Vite) nên bot không
 * chạy JavaScript ⇒ mọi route sẽ cùng một thẻ OG nếu không có lớp này.
 *
 * nginx của web nhận diện User-Agent bot rồi proxy sang `/__prerender<đường-dẫn>`; người
 * dùng thật vẫn nhận SPA như thường. Không bật nginx thì route này chỉ đơn giản không được gọi
 * — thẻ OG tĩnh trong index.html vẫn hoạt động cho trang chủ.
 */
import { Router } from 'express';
import { Post } from '../models/Post.js';
import { getSiteSetting, siteToPublic } from './site.js';
import { wrap } from '../middleware/errors.js';

export const prerenderRouter = Router();

const BRAND = 'Work Assistant';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Gốc URL công khai dựng từ header do nginx chuyển tiếp (không gắn cứng tên miền). */
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'volcanion.vn').toString();
  return `${proto}://${host}`;
}

/** Ảnh bìa bài viết là đường dẫn tương đối (/uploads/…) ⇒ đổi thành tuyệt đối cho bot. */
function absUrl(base, url) {
  if (!url) return `${base}/og.png`;
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** HTML thuần chỉ để bot đọc <head>; người thật gần như không bao giờ thấy trang này. */
export function renderOgHtml({ title, description, url, image, canonical }) {
  const t = esc(title);
  const d = esc(description);
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="canonical" href="${esc(canonical || url)}" />
<meta property="og:site_name" content="${esc(BRAND)}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="vi_VN" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${esc(image)}" />
</head>
<body>
<h1>${t}</h1>
<p>${d}</p>
<p><a href="${esc(url)}">Mở ${esc(BRAND)}</a></p>
</body>
</html>`;
}

const trimName = (s, n = 200) => {
  const v = String(s || '').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

prerenderRouter.get(/.*/, wrap(async (req, res) => {
  const base = baseUrl(req);
  const path = req.path || '/';
  const site = siteToPublic(await getSiteSetting());
  const appName = site.appName || BRAND;
  const tagline = site.tagline || 'Trợ lý công việc đa nguồn';
  const heroSub =
    (site.hero && site.hero.subtitle) ||
    'Gom Zalo, Telegram, Email và Lark về một chỗ. AI chạy trên máy bạn, gửi bản tin giọng nói mỗi sáng — chiều.';

  // Mặc định = trang chủ.
  let meta = {
    title: `${appName} — ${tagline}`,
    description: heroSub,
    url: `${base}${path === '/' ? '/' : path}`,
    image: `${base}/og.png`,
  };

  // Bài viết / hướng dẫn: lấy đúng tiêu đề + trích đoạn + ảnh bìa của bài.
  const slugMatch = path.match(/^\/(?:bai-viet|huong-dan)\/([^/]+)\/?$/);
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]);
    const post = await Post.findOne({ slug, publishedAt: { $ne: null } }).lean();
    if (post) {
      meta = {
        title: `${post.title} — ${appName}`,
        description: trimName(post.excerpt || heroSub),
        url: `${base}${path}`,
        image: absUrl(base, post.coverImageUrl),
      };
    }
  } else if (path === '/tai-ve') {
    meta.title = `Tải ${appName} — macOS & Windows`;
    meta.description = 'Tải bản cho máy tính của bạn. Cài xong đăng nhập và kết nối nguồn là dùng được.';
    meta.url = `${base}/tai-ve`;
  } else if (path === '/cap-nhat') {
    meta.title = `Lịch sử phiên bản — ${appName}`;
    meta.description = 'Những gì đã thay đổi trong từng bản phát hành, kèm tệp cài cho từng nền tảng.';
    meta.url = `${base}/cap-nhat`;
  } else if (path === '/huong-dan') {
    meta.title = `Hướng dẫn sử dụng — ${appName}`;
    meta.description = 'Cài đặt, kết nối Zalo/Telegram/Email/Lark, bật AI cục bộ và nhận bản tin giọng nói.';
    meta.url = `${base}/huong-dan`;
  } else if (path === '/bai-viet') {
    meta.title = `Bài viết — ${appName}`;
    meta.description = 'Thông báo, ghi chú phát hành và hướng dẫn dùng Work Assistant.';
    meta.url = `${base}/bai-viet`;
  }

  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(renderOgHtml(meta));
}));
