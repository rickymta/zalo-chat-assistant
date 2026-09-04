/**
 * Cấu hình đường dẫn + thiết lập người dùng.
 *
 * Mọi dữ liệu sinh ra lúc chạy nằm trong `data/` (gitignore): CSDL SQLite, phiên đăng nhập, gói xuất, log.
 * Đổi thư mục dữ liệu bằng biến môi trường ZCA_DATA_DIR (vd để đặt lên iCloud/Drive).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.ZCA_DATA_DIR
  ? path.resolve(process.env.ZCA_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const EXPORTS_DIR = process.env.ZCA_EXPORTS_DIR
  ? path.resolve(process.env.ZCA_EXPORTS_DIR)
  : path.join(DATA_DIR, 'exports');   // Electron đặt vào ~/Documents/Zalo Chat Assistant
export const DB_PATH = path.join(DATA_DIR, 'zalo.db');
export const LOG_PATH = path.join(DATA_DIR, 'app.log');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
export const COWORK_DIR = path.join(ROOT_DIR, 'cowork');
export const UI_DIR = path.join(__dirname, 'ui');

export const PORT = Number(process.env.PORT ?? 3789);
export const HOST = '127.0.0.1';   // CHỈ nghe trên máy này — không bao giờ mở ra mạng LAN
export const OPEN_BROWSER = (process.env.OPEN_BROWSER ?? 'true') !== 'false';

/** Thiết lập mặc định — người dùng đổi trên giao diện, lưu ở data/settings.json. */
const DEFAULT_SETTINGS = Object.freeze({
  /** Có lưu tin nhắn NHÓM không (mặc định tắt — cùng quyết định với CRM đợt 1). */
  includeGroups: false,
  /** Khi listener nối lại, tự yêu cầu Zalo gửi phần tin đã bỏ lỡ lúc tắt máy. */
  syncOldOnConnect: true,
  /** Hội thoại có tin cuối là của KHÁCH và đã quá số giờ này ⇒ đánh dấu "quá hạn trả lời". */
  waitingHours: 2,
});

export function ensureDirs() {
  for (const dir of [DATA_DIR, SESSIONS_DIR, EXPORTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Thư mục phiên chứa cookie đăng nhập thật — chỉ chủ máy đọc được.
  try { fs.chmodSync(SESSIONS_DIR, 0o700); } catch { /* FS không hỗ trợ thì bỏ qua */ }
}

export function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  // Chỉ giữ khoá hợp lệ — tránh ai đó POST rác vào file thiết lập.
  const clean = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) clean[key] = next[key];
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(clean, null, 2));
  return clean;
}
