/**
 * Điểm vào Electron — biến lõi (src/app.js) thành ứng dụng macOS: cửa sổ riêng, không cần cài Node,
 * chạy nền khi đóng cửa sổ (biểu tượng vẫn ở Dock), tự mở khi bật máy (tuỳ chọn).
 *
 * Dữ liệu: ~/Library/Application Support/Zalo Chat Assistant/data   (CSDL, phiên đăng nhập, log)
 * Gói xuất: ~/Documents/Zalo Chat Assistant/                        (người dùng dễ tìm trong Finder)
 */
import { clipboard, app, BrowserWindow, Menu, shell, dialog, powerSaveBlocker, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

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
  /** Mở liên kết bằng trình duyệt mặc định (nút "Tải về" của thanh cập nhật) — không mở trong cửa sổ ứng dụng. */
  openExternal(url) { shell.openExternal(url); },
  copyText(t) { clipboard.writeText(String(t ?? '')); return true; },
  getAutoStart() { try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; } },
  blockerId: null,
  /** Chống ngủ: 'prevent-app-suspension' giữ hệ thống thức nhưng vẫn cho tắt màn hình (tương đương caffeinate -i). */
  setKeepAwake(v) {
    if (v) { if (this.blockerId == null || !powerSaveBlocker.isStarted(this.blockerId)) this.blockerId = powerSaveBlocker.start('prevent-app-suspension'); }
    else if (this.blockerId != null) { try { powerSaveBlocker.stop(this.blockerId); } catch { /* bỏ qua */ } this.blockerId = null; }
    return this.getKeepAwake();
  },
  getKeepAwake() { return this.blockerId != null && powerSaveBlocker.isStarted(this.blockerId); },
  async pickFiles({ filters, multi } = {}) {
    const r = await dialog.showOpenDialog(win ?? undefined, { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters: Array.isArray(filters) ? filters : undefined });
    return r.canceled ? [] : r.filePaths;
  },
  setAutoStart(v) { try { app.setLoginItemSettings({ openAtLogin: !!v, openAsHidden: true }); } catch { /* bỏ qua */ } return this.getAutoStart(); },
  /**
   * Cài bộ cài đã tải (src/updates.js đã đối chiếu SHA-256) rồi mở lại ứng dụng.
   * Trả { ok:true } khi đã bắt đầu (ứng dụng sẽ tự thoát), hoặc { manual:true, reason } khi máy này không tự cài được —
   * giao diện sẽ đưa người dùng sang tải bằng trình duyệt. Bản chưa ký nên không dùng autoUpdater của Electron.
   */
  async installUpdate({ file }) {
    if (!file || !fs.existsSync(file)) return { manual: true, reason: 'Không thấy tệp đã tải.' };
    if (process.platform === 'darwin') return installOnMac(file);
    if (process.platform === 'win32') return installOnWindows(file);
    return { manual: true, reason: 'Hệ này chưa hỗ trợ tự cài.' };
  },
};

/**
 * macOS: gắn DMG (không hiện Finder), chép .app trong đó ra cạnh bundle đang chạy bằng ditto (giữ nguyên chữ ký/metadata),
 * đổi tên hoán chỗ (bundle cũ → .old), gỡ DMG, hẹn xoá bundle cũ sau khi thoát rồi mở lại. Tệp do chính ứng dụng tải nên không
 * mang cờ quarantine ⇒ Gatekeeper không hỏi lại. Không ghi được vào thư mục chứa ứng dụng thì trả manual để người dùng cài tay.
 */
async function installOnMac(file) {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!bundle.endsWith('.app')) return { manual: true, reason: 'Không xác định được vị trí ứng dụng đang chạy.' };
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return { manual: true, reason: 'Ứng dụng đang chạy từ vị trí tạm (chưa được kéo vào Applications).' };
  const parent = path.dirname(bundle);
  try { fs.accessSync(parent, fs.constants.W_OK); } catch { return { manual: true, reason: `Không có quyền ghi vào ${parent}.` }; }

  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'zca-update-'));
  const base = path.basename(bundle, '.app');
  const staging = path.join(parent, `.${base}-update-${process.pid}.app`);
  const old = path.join(parent, `.${base}-old-${process.pid}.app`);
  try {
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-quiet', '-mountpoint', mount, file]);
  } catch (err) {
    fs.rmSync(mount, { recursive: true, force: true });
    return { manual: true, reason: `Không mở được tệp DMG: ${String(err?.stderr || err?.message || err).trim().slice(0, 200)}` };
  }
  try {
    const appName = fs.readdirSync(mount).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('Trong tệp tải về không có ứng dụng .app.');
    fs.rmSync(staging, { recursive: true, force: true });
    await run('ditto', [path.join(mount, appName), staging]);
    if (!fs.existsSync(path.join(staging, 'Contents', 'Info.plist'))) throw new Error('Bản chép ra thiếu Contents/Info.plist.');
    fs.renameSync(bundle, old);
    try { fs.renameSync(staging, bundle); } catch (err) { fs.renameSync(old, bundle); throw err; }
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    await run('hdiutil', ['detach', mount, '-quiet', '-force']).catch(() => {});
    fs.rmSync(mount, { recursive: true, force: true });
    return { manual: true, reason: `Không thay được ứng dụng: ${String(err?.stderr || err?.message || err).trim().slice(0, 200)}` };
  }
  await run('hdiutil', ['detach', mount, '-quiet', '-force']).catch(() => {});
  fs.rmSync(mount, { recursive: true, force: true });
  // Bundle cũ vẫn đang chạy tiến trình này — xoá sau khi đã thoát (tiến trình mới chạy từ bundle mới ở đúng đường dẫn cũ).
  spawn('/bin/sh', ['-c', `sleep 8; rm -rf "${old.replace(/"/g, '\\"')}"`], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { app.relaunch(); app.quit(); }, 600);
  return { ok: true, relaunch: true };
}

/**
 * Windows: chạy bộ cài NSIS ngầm (/S) — bộ cài per-user không cần quyền quản trị; --force-run để nó mở lại ứng dụng khi xong.
 * Ứng dụng tự thoát ngay sau đó để bộ cài thay được tệp.
 */
function installOnWindows(file) {
  try {
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (err) {
    return { manual: true, reason: `Không chạy được bộ cài: ${err?.message ?? err}` };
  }
  setTimeout(() => app.quit(), 800);
  return { ok: true, relaunch: true };
}

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
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
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
    // Máy ngủ/thức: báo lõi để ghi khoảng trống, nối lại Zalo và xin tin bỏ lỡ. Khoá màn hình không ảnh hưởng.
    powerMonitor.on('suspend', () => core?.power?.onSuspend('sleep'));
    powerMonitor.on('resume', () => core?.power?.onResume('sleep'));
    powerMonitor.on('lock-screen', () => core?.log?.info('Màn hình đã khoá — ứng dụng vẫn chạy và lưu tin.'));
    powerMonitor.on('unlock-screen', () => core?.log?.info('Màn hình đã mở khoá.'));
    buildMenu();
    createWindow(core.url);
  } catch (err) {
    dialog.showErrorBox('Không khởi động được ứng dụng', String(err?.stack ?? err));
    app.exit(1);
  }
});
