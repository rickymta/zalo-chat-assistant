/**
 * better-sqlite3 là module native: bản build cho Node KHÔNG chạy được trong Electron và ngược lại; bản cho macOS KHÔNG
 * chạy được trên Windows. Script này đặt đúng tệp build/Release/better_sqlite3.node cho đích cần dựng và KIỂM TRA định dạng
 * tệp (Mach-O arm64 / Mach-O x86_64 / PE32+) trước khi cho đóng gói — sai là dừng, không đóng gói bản hỏng.
 *
 *   node scripts/ensure-native.js node          → trước `npm start` (chạy bằng Node trên máy này)
 *   node scripts/ensure-native.js electron      → trước `npm run app` / `npm run dist`   (Electron, chip máy này)
 *   node scripts/ensure-native.js electron-x64  → trước `npm run dist:x64`               (Electron, Mac Intel)
 *   node scripts/ensure-native.js electron-win  → trước `npm run dist:win`               (Electron, Windows x64)
 *
 * Đích chéo (x64, win) dùng prebuilt chính thức của better-sqlite3 qua prebuild-install (có sẵn trong node_modules);
 * `electron-builder install-app-deps --platform win32` từng để nguyên tệp Mac ⇒ bản Windows 0.0.2 không khởi động được.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'node_modules', '.zca-native-target');
const pkgDir = path.join(root, 'node_modules', 'better-sqlite3');
const binary = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;

const TARGETS = {
  node: { runtime: 'node', platform: process.platform, arch: process.arch },
  electron: { runtime: 'electron', platform: process.platform, arch: process.arch },
  'electron-x64': { runtime: 'electron', platform: 'darwin', arch: 'x64' },
  'electron-win': { runtime: 'electron', platform: 'win32', arch: 'x64' },
};
const target = Object.keys(TARGETS).includes(process.argv[2]) ? process.argv[2] : 'node';
const spec = TARGETS[target];

/** Chữ ký `file` mong đợi theo hệ/kiến trúc. */
function expectedSignature({ platform, arch }) {
  if (platform === 'win32') return /PE32\+ executable.*x86-64/;
  if (platform === 'darwin') return arch === 'arm64' ? /Mach-O 64-bit bundle arm64/ : /Mach-O 64-bit bundle x86_64/;
  return /ELF 64-bit/;
}
function describe() {
  try { return execSync(`file -b "${binary}"`, { encoding: 'utf8' }).trim(); } catch { return '(không đọc được)'; }
}
function matches() { return fs.existsSync(binary) && expectedSignature(spec).test(describe()); }

const current = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
if (current === target && matches()) process.exit(0);

console.log(`[ensure-native] Đặt better-sqlite3 cho ${target} (${spec.runtime} · ${spec.platform}-${spec.arch})…`);
if (spec.runtime === 'node') {
  execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit' });
} else {
  // Prebuilt chính thức (tải về ~/.npm/_prebuilds, lần sau dùng lại); Electron ABI suy từ phiên bản Electron trong node_modules.
  const cmd = `npx --yes prebuild-install -r electron -t ${electronVersion} --platform ${spec.platform} --arch ${spec.arch}`;
  try {
    execSync(cmd, { cwd: pkgDir, stdio: 'inherit' });
  } catch (err) {
    if (spec.platform === process.platform && spec.arch === process.arch) {
      console.log('[ensure-native] Không có prebuilt — dựng từ nguồn bằng electron-builder install-app-deps…');
      execSync('npx electron-builder install-app-deps', { cwd: root, stdio: 'inherit' });
    } else {
      throw err;
    }
  }
}

const got = describe();
if (!matches()) {
  console.error(`[ensure-native] SAI KIẾN TRÚC: cần ${expectedSignature(spec)} nhưng tệp là "${got}". Dừng, không đóng gói.`);
  try { fs.unlinkSync(marker); } catch { /* bỏ qua */ }
  process.exit(1);
}
fs.writeFileSync(marker, target);
console.log(`[ensure-native] OK: ${got}`);
