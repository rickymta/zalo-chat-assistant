import { useCallback, useEffect, useState } from 'react';

/**
 * Giao diện sáng/tối.
 * - Mặc định theo hệ điều hành (CSS `prefers-color-scheme`).
 * - Người dùng chọn tay ⇒ ghi `data-theme="light|dark"` lên <html> và nhớ trong localStorage.
 * - index.html có một đoạn script nhỏ đọc localStorage TRƯỚC khi vẽ để không chớp màu.
 */

const KEY = 'wa-theme';

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function systemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Trả { theme: 'light'|'dark' đang hiệu lực, stored: lựa chọn tay hoặc null, toggle, set }. */
export function useTheme() {
  const [stored, setStored] = useState(readStoredTheme);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const set = useCallback((next) => {
    try {
      if (next) localStorage.setItem(KEY, next);
      else localStorage.removeItem(KEY);
    } catch {
      /* chế độ riêng tư chặn localStorage — vẫn đổi được cho phiên này */
    }
    applyTheme(next);
    setStored(next);
  }, []);

  const theme = stored || system;
  const toggle = useCallback(() => set(theme === 'dark' ? 'light' : 'dark'), [set, theme]);

  return { theme, stored, set, toggle };
}
