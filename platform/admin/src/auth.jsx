import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearSession,
  ensureAccessToken,
  get,
  getRefreshToken,
  post,
  saveSession,
  setSessionLostHandler,
} from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [keyVersion, setKeyVersion] = useState(null);
  // 'checking' lúc mới mở trang (đang thử dựng lại phiên từ refresh token)
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyAuth = useCallback((data) => {
    saveSession(data);
    if (data && data.user) setUser(data.user);
    return data;
  }, []);

  const forgetLocal = useCallback(() => {
    clearSession();
    setUser(null);
    setKeyVersion(null);
  }, []);

  // Phiên hết hiệu lực giữa chừng (refresh token bị thu hồi) ⇒ dọn trạng thái.
  useEffect(() => {
    setSessionLostHandler(() => {
      if (mounted.current) {
        setUser(null);
        setKeyVersion(null);
      }
    });
    return () => setSessionLostHandler(null);
  }, []);

  // Mở trang: có refresh token ⇒ đổi lấy access token rồi lấy hồ sơ.
  // Dùng ensureAccessToken (đã gộp lời gọi trùng) chứ KHÔNG gọi thẳng /api/auth/refresh —
  // refresh token xoay vòng nên gọi hai lần là lần sau chắc chắn 401 và mất phiên oan.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const ok = await ensureAccessToken();
        if (!ok) {
          clearSession(); // refresh token hỏng/hết hạn — coi như chưa đăng nhập
          return;
        }
        const me = await get('/api/me');
        if (!cancelled) {
          setUser(me.user);
          setKeyVersion(me.keyVersion ?? null);
        }
      } catch {
        // Lỗi mạng khi lấy hồ sơ: giữ nguyên refresh token để lần sau thử lại.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email, password) => {
      const data = await post(
        '/api/auth/login',
        { email, password, device: deviceName() },
        { auth: false },
      );
      applyAuth(data);
      setKeyVersion(data.encryptionKey ? data.encryptionKey.version : null);
      return data.user;
    },
    [applyAuth],
  );

  const register = useCallback(
    async ({ email, password, name, registrationCode }) => {
      const data = await post(
        '/api/auth/register',
        { email, password, name, registrationCode, device: deviceName() },
        { auth: false },
      );
      applyAuth(data);
      setKeyVersion(data.encryptionKey ? data.encryptionKey.version : null);
      return data.user;
    },
    [applyAuth],
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await post('/api/auth/logout', { refreshToken });
    } catch {
      /* luôn đăng xuất phía trình duyệt dù máy chủ lỗi */
    }
    forgetLocal();
  }, [forgetLocal]);

  const reloadMe = useCallback(async () => {
    const me = await get('/api/me');
    setUser(me.user);
    setKeyVersion(me.keyVersion ?? null);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      user,
      role: user ? user.role : null,
      isAdmin: !!user && user.role === 'admin',
      keyVersion,
      setKeyVersion,
      loading,
      login,
      register,
      logout,
      reloadMe,
      setUser,
    }),
    [user, keyVersion, loading, login, register, logout, reloadMe],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}

/** Tên thiết bị gửi kèm khi đăng nhập, để người dùng nhận ra phiên trong màn Tài khoản. */
function deviceName() {
  const ua = navigator.userAgent || '';
  let os = 'Máy tính';
  if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = 'trình duyệt';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  return `${browser} trên ${os} (web)`;
}
