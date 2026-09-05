import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from './api.js';

/**
 * Cấu hình trang chủ (GET /api/site) — dùng ở header, footer, trang chủ, trang tải về.
 * Tải một lần cho cả ứng dụng; admin sửa xong gọi reload() để làm mới ngay.
 */

const SiteCtx = createContext(null);

const FALLBACK = {
  appName: 'Zalo Chat Assistant',
  tagline: 'Trợ lý hội thoại Zalo cho tư vấn viên',
  hero: {
    title: 'Zalo Chat Assistant',
    subtitle:
      'Kết nối Zalo cá nhân bằng mã QR, lưu mọi tin nhắn vào máy ở dạng mã hoá, để Claude Cowork tổng hợp hội thoại và đề xuất câu trả lời.',
  },
  features: [],
  contact: {},
  latest: {},
};

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
        hero: { ...FALLBACK.hero, ...(data && data.hero) },
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
