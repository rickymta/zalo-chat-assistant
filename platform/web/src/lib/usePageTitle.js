import { useEffect } from 'react';
import { BRAND_NAME } from '../components/Brand.jsx';

/** Đặt tiêu đề tab "<trang> — Work Assistant"; rời trang thì trả lại tên mặc định. */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${BRAND_NAME}` : BRAND_NAME;
    return () => {
      document.title = BRAND_NAME;
    };
  }, [title]);
}
