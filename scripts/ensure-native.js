/**
 * better-sqlite3 là module native: bản build cho Node KHÔNG chạy được trong Electron và ngược lại.
 * Script này giữ một dấu mốc trong node_modules để biết đang build cho runtime nào, đổi khi cần.
 *
 *   node scripts/ensure-native.js node      → trước `npm start` (chạy bằng Node)
 *   node scripts/ensure-native.js electron  → trước `npm run app` / `npm run dist`
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'node_modules', '.zca-native-target');
// 'electron' = Electron kiến trúc máy này (arm64); 'electron-x64' = Electron cho Mac Intel (tải prebuilt x64 của better-sqlite3).
const target = ['electron', 'electron-x64'].includes(process.argv[2]) ? process.argv[2] : 'node';
const current = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';

if (current === target) process.exit(0);

console.log(`[ensure-native] Dựng lại better-sqlite3 cho ${target}…`);
if (target === 'electron') {
  execSync('npx electron-builder install-app-deps', { cwd: root, stdio: 'inherit' });
} else if (target === 'electron-x64') {
  execSync('npx electron-builder install-app-deps --arch x64', { cwd: root, stdio: 'inherit' });
} else {
  execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit' });
}
fs.writeFileSync(marker, target);
