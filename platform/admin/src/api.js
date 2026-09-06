/**
 * Lớp gọi API theo platform/API-CONTRACT.md.
 *
 * Quy ước bảo mật:
 *  - accessToken CHỈ giữ trong bộ nhớ (biến module) — không ghi localStorage để giảm rủi ro XSS.
 *  - refreshToken giữ trong localStorage để mở lại trình duyệt không phải đăng nhập lại.
 *  - Gặp 401 ⇒ tự gọi /api/auth/refresh MỘT lần rồi gọi lại request cũ; vẫn 401 ⇒ dọn phiên.
 */

const REFRESH_KEY = 'zca.refreshToken';

/** Access token trong bộ nhớ (mất khi F5 — sẽ được dựng lại từ refresh token). */
let accessToken = null;
/** Chống gọi /refresh nhiều lần song song: mọi request cùng chờ một lời hứa. */
let refreshingPromise = null;
/** Được AuthProvider đăng ký để biết khi phiên bị mất hiệu lực. */
let onSessionLost = null;

export class ApiError extends Error {
  constructor(message, status, code, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload || null;
  }
}

export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null; // trình duyệt chặn storage (chế độ riêng tư)
  }
}

/** Lưu lại phiên sau login/register/refresh. */
export function saveSession(data) {
  if (!data) return;
  accessToken = data.accessToken || null;
  try {
    if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
  } catch {
    /* bỏ qua: vẫn dùng được trong phiên hiện tại */
  }
}

export function clearSession() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* bỏ qua */
  }
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

async function rawRequest(path, { method = 'GET', body, auth = true, headers = {}, signal } = {}) {
  const h = { ...headers };
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (auth && accessToken) h.Authorization = `Bearer ${accessToken}`;
  // Luôn gọi bằng đường dẫn tương đối (cùng origin): dev đi qua proxy của Vite,
  // production đi qua nginx. Nhờ vậy đổi tên miền không phải build lại.
  return fetch(path, { method, headers: h, body: payload, signal });
}

/**
 * Đảm bảo có access token dùng được: đổi refresh token đang lưu lấy access token mới.
 * Trả về true nếu thành công. Nhiều lời gọi cùng lúc dùng CHUNG một lần gọi mạng —
 * quan trọng vì refresh token XOAY VÒNG: gọi hai lần song song thì lần sau dùng token đã bị
 * thu hồi ⇒ 401 ⇒ mất phiên oan (React StrictMode chạy effect hai lần là dính ngay).
 */
export function ensureAccessToken() {
  return refreshAccessToken();
}

/** Gọi /api/auth/refresh; trả về true nếu lấy được access token mới. */
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshingPromise) {
    refreshingPromise = (async () => {
      try {
        const res = await rawRequest('/api/auth/refresh', {
          method: 'POST',
          body: { refreshToken },
          auth: false,
        });
        if (!res.ok) return false;
        const data = await readBody(res);
        if (!data || !data.accessToken) return false;
        saveSession(data);
        return true;
      } catch {
        return false; // mất mạng — không coi là hết phiên
      } finally {
        // nhả sau một nhịp để các request đang chờ đọc xong kết quả
        setTimeout(() => {
          refreshingPromise = null;
        }, 0);
      }
    })();
  }
  return refreshingPromise;
}

/**
 * Gọi API và trả về JSON đã parse. Lỗi ⇒ ném ApiError với câu tiếng Việt lấy từ `error`.
 */
export async function api(path, opts = {}) {
  let res;
  try {
    res = await rawRequest(path, opts);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0, 'NETWORK');
  }

  // Hết hạn access token ⇒ làm mới đúng một lần rồi thử lại.
  if (res.status === 401 && opts.auth !== false && getRefreshToken() && !opts._retried) {
    const ok = await refreshAccessToken();
    if (ok) return api(path, { ...opts, _retried: true });
    clearSession();
    if (onSessionLost) onSessionLost();
  }

  const data = await readBody(res);
  if (!res.ok) {
    if (res.status === 401 && opts.auth !== false) {
      clearSession();
      if (onSessionLost) onSessionLost();
    }
    const message =
      (data && data.error) ||
      (res.status === 403
        ? 'Bạn không có quyền thực hiện thao tác này.'
        : res.status === 404
          ? 'Không tìm thấy nội dung.'
          : res.status === 429
            ? 'Bạn thao tác quá nhanh. Chờ một phút rồi thử lại.'
            : 'Máy chủ gặp lỗi. Vui lòng thử lại sau.');
    throw new ApiError(message, res.status, data && data.code, data);
  }
  return data;
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

/** Ghép query string, bỏ các giá trị rỗng/undefined. */
export function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.set(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * Tải file lên bằng XHR để có tiến trình (fetch không báo tiến trình upload).
 * onProgress nhận số phần trăm 0..100.
 * Tự làm mới access token một lần nếu gặp 401.
 */
export function uploadWithProgress(path, formData, onProgress, { _retried = false } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new ApiError('Không kết nối được máy chủ khi tải tệp lên.', 0, 'NETWORK'));
    xhr.onabort = () => reject(new ApiError('Đã huỷ tải tệp lên.', 0, 'ABORTED'));
    xhr.onload = async () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      if (xhr.status === 401 && !_retried && getRefreshToken()) {
        const ok = await refreshAccessToken();
        if (ok) {
          uploadWithProgress(path, formData, onProgress, { _retried: true }).then(resolve, reject);
          return;
        }
        clearSession();
        if (onSessionLost) onSessionLost();
      }
      reject(
        new ApiError(
          (data && data.error) || 'Tải tệp lên thất bại.',
          xhr.status,
          data && data.code,
          data,
        ),
      );
    };
    xhr.send(formData);
  });
}
