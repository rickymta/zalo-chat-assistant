import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from './api.js';
import { BRAND_NAME, BRAND_TAGLINE } from './components/Brand.jsx';

/**
 * Cấu hình trang chủ (GET /api/site) — dùng ở header, footer, trang chủ, trang tải về.
 * Tải một lần cho cả ứng dụng; admin sửa xong gọi reload() để làm mới ngay.
 */

const SiteCtx = createContext(null);

const FALLBACK = {
  appName: BRAND_NAME,
  tagline: BRAND_TAGLINE,
  hero: {
    title: 'Tổng hợp công việc từ Zalo, Telegram, Email và Lark',
    subtitle:
      'Gom tin nhắn, thư và phiếu duyệt về một chỗ ngay trên máy bạn, mã hoá tại chỗ, để AI cục bộ tóm tắt việc cần làm và đọc thành bản tin giọng nói mỗi sáng – chiều. Máy chủ chỉ giữ tài khoản, không bao giờ nhận nội dung.',
  },
  features: [],
  contact: {},
  latest: {},
};

/**
 * Tên/khẩu hiệu/hero còn là giá trị mặc định của các bản cũ ("Chat Assistant", "Zalo Chat Assistant")
 * thì hiển thị theo thương hiệu mới. Chỉ thay khi khớp NGUYÊN VĂN mặc định cũ — quản trị viên
 * đã tự đặt nội dung riêng thì giữ nguyên.
 */
const LEGACY_NAMES = new Set(['chat assistant', 'zalo chat assistant']);
const LEGACY_TAGLINES = new Set([
  'trợ lý hội thoại zalo cho tư vấn viên',
  'trợ lý trả lời tin nhắn zalo cho phòng khám',
]);
const LEGACY_HERO_SUBTITLES = new Set([
  'đăng nhập zalo bằng qr, lưu hội thoại vào máy bạn, để claude gợi ý câu trả lời.',
  'kết nối zalo cá nhân bằng mã qr, lưu mọi tin nhắn vào máy ở dạng mã hoá, để claude cowork tổng hợp hội thoại và đề xuất câu trả lời.',
]);
const norm = (s) => String(s || '').trim().toLowerCase();

function modernize(data) {
  const d = data || {};
  const hero = d.hero || {};
  const appName = !d.appName || LEGACY_NAMES.has(norm(d.appName)) ? FALLBACK.appName : d.appName;
  const tagline = !d.tagline || LEGACY_TAGLINES.has(norm(d.tagline)) ? FALLBACK.tagline : d.tagline;
  const heroTitle = !hero.title || LEGACY_NAMES.has(norm(hero.title)) ? FALLBACK.hero.title : hero.title;
  const heroSubtitle =
    !hero.subtitle || LEGACY_HERO_SUBTITLES.has(norm(hero.subtitle)) ? FALLBACK.hero.subtitle : hero.subtitle;
  return { appName, tagline, hero: { title: heroTitle, subtitle: heroSubtitle } };
}

export function SiteProvider({ children }) {
  const [site, setSite] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get('/api/site', { auth: false });
      // Máy chủ có thể bỏ trống vài nhóm — trộn với giá trị mặc định để giao diện không vỡ.
      setSite({
        ...FALLBACK,
        ...data,
        ...modernize(data),
        features: (data && data.features) || [],
        contact: (data && data.contact) || {},
        latest: (data && data.latest) || {},
      });
      setError(null);
    } catch (err) {
      setError(err); // vẫn dựng trang bằng nội dung mặc định
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(() => ({ site, loading, error, reload: load }), [site, loading, error, load]);
  return <SiteCtx.Provider value={value}>{children}</SiteCtx.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteCtx);
  if (!ctx) throw new Error('useSite phải nằm trong <SiteProvider>');
  return ctx;
}
