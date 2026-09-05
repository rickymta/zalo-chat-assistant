/**
 * Điểm vào Electron — biến lõi (src/app.js) thành ứng dụng macOS: cửa sổ riêng, không cần cài Node,
 * chạy nền khi đóng cửa sổ (biểu tượng vẫn ở Dock), tự mở khi bật máy (tuỳ chọn).
 *
 * Dữ liệu: ~/Library/Application Support/Zalo Chat Assistant/data   (CSDL, phiên đăng nhập, log)
 * Gói xuất: ~/Documents/Zalo Chat Assistant/                        (người dùng dễ tìm trong Finder)
 */
import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const PRODUCT = 'Zalo Chat Assistant';
app.setName(PRODUCT);

// Đặt thư mục dữ liệu TRƯỚC khi nạp lõi — src/config.js đọc biến môi trường ngay lúc import.
// Cho phép ghi đè bằng biến môi trường (hỗ trợ kỹ thuật / chạy thử với dữ liệu mẫu):
//   ZCA_DATA_DIR=/duong/dan "/Applications/Zalo Chat Assistant.app/Contents/MacOS/Zalo Chat Assistant"
const dataDir = process.env.ZCA_DATA_DIR || path.join(app.getPath('userData'), 'data');
const workspaceDir = process.env.ZCA_WORKSPACE_DIR || path.join(app.getPath('documents'), PRODUCT);
const exportsDir = process.env.ZCA_EXPORTS_DIR || path.join(workspaceDir, 'du-lieu');
process.env.ZCA_DATA_DIR = dataDir;
process.env.ZCA_WORKSPACE_DIR = workspaceDir;
process.env.ZCA_EXPORTS_DIR = exportsDir;
process.env.OPEN_BROWSER = 'false';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let core = null;
let quitting = false;

const platform = {
  name: 'electron',
  appVersion: app.getVersion(),
  revealPath(p) { shell.openPath(p); },
  getAutoStart() { try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; } },
  setAutoStart(v) { try { app.setLoginItemSettings({ openAtLogin: !!v, openAsHidden: true }); } catch { /* bỏ qua */ } return this.getAutoStart(); },
};

async function startCore() {
  const { startApp } = await import('../src/app.js');
  // Thử vài cổng liên tiếp — phòng khi bản chạy bằng Node đang chiếm cổng mặc định.
  let lastErr = null;
  for (let port = 3789; port < 3799; port++) {
    try { return await startApp({ platform, port }); } catch (err) { lastErr = err; if (err?.code !== 'EADDRINUSE') break; }
  }
  throw lastErr;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 980, minHeight: 640,
    title: PRODUCT,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f4f6fa',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
  // Đóng cửa sổ = ẩn đi, ứng dụng vẫn chạy nền để tiếp tục lưu tin. Thoát hẳn bằng ⌘Q.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    {
      label: PRODUCT,
      submenu: [
        { label: `Về ${PRODUCT}`, click: () => dialog.showMessageBox({ message: PRODUCT, detail: `Phiên bản ${app.getVersion()}\nLưu tin nhắn Zalo cá nhân (mã hoá) và chuẩn bị dữ liệu cho Claude Cowork.\n\nDữ liệu: ${dataDir}\nThư mục Claude: ${workspaceDir}` }) },
        { type: 'separator' },
        { label: 'Mở thư mục làm việc với Claude', click: () => { fs.mkdirSync(workspaceDir, { recursive: true }); shell.openPath(workspaceDir); } },
        { label: 'Mở thư mục dữ liệu', click: () => shell.openPath(dataDir) },
        { type: 'separator' },
        { role: 'hide', label: `Ẩn ${PRODUCT}` }, { role: 'hideOthers', label: 'Ẩn ứng dụng khác' }, { role: 'unhide', label: 'Hiện tất cả' },
        { type: 'separator' },
        { role: 'quit', label: `Thoát ${PRODUCT}` },
      ],
    },
    { label: 'Chỉnh sửa', submenu: [{ role: 'undo', label: 'Hoàn tác' }, { role: 'redo', label: 'Làm lại' }, { type: 'separator' }, { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' }, { role: 'paste', label: 'Dán' }, { role: 'selectAll', label: 'Chọn tất cả' }] },
    { label: 'Cửa sổ', submenu: [{ label: 'Mở cửa sổ chính', accelerator: 'CmdOrCtrl+1', click: showWindow }, { role: 'minimize', label: 'Thu nhỏ' }, { role: 'reload', label: 'Tải lại' }, { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showWindow() {
  if (win) { win.show(); win.focus(); } else if (core) createWindow(core.url);
}

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => { /* macOS: giữ ứng dụng chạy nền */ });
app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  // Không chờ quá 4 giây: thà thoát hơi vội còn hơn ứng dụng kẹt không tắt được.
  await Promise.race([
    (async () => { try { await core?.stop(); } catch { /* bỏ qua */ } })(),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  app.exit(0);
});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    core = await startCore();
    buildMenu();
    createWindow(core.url);
  } catch (err) {
    dialog.showErrorBox('Không khởi động được ứng dụng', String(err?.stack ?? err));
    app.exit(1);
  }
});
