/**
 * Bộ khung kiểm thử dùng chung cho smoke.mjs và compat-appclient.mjs.
 *
 * Mặc định script TỰ KHỞI ĐỘNG một tiến trình API con rồi tắt khi xong — nhờ vậy đọc được mã đặt lại
 * mật khẩu trên stdout (không có SMTP thì mã chỉ ghi ra log) và mỗi lần chạy có bộ đếm giới hạn tần suất
 * sạch sẽ. Muốn bắn vào một máy chủ đang chạy sẵn thì truyền `--base http://127.0.0.1:4791`.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv = process.argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cổng có đang bị chiếm không (kể cả bởi tiến trình của người khác trên máy này)? */
function portBusy(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

/** Xin hệ điều hành một cổng trống. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Khởi động API con, đợi CHÍNH NÓ báo sẵn sàng. Trả { base, lines, stop() }.
 *
 * ⚠️ Đừng rút gọn thành "gọi /health thấy 200 là xong": nếu có tiến trình KHÁC đang giữ cổng đó
 * (ví dụ máy chủ mock của nhóm web ở 4791) thì /health vẫn 200 — và cả bộ test sẽ lặng lẽ chấm điểm
 * cho máy chủ của người khác. Đã dính đúng bẫy này một lần: 12 ca "trượt" với câu lỗi lạ hoắc.
 * Vì vậy: cổng bận ⇒ tự nhảy sang cổng trống khác; và chỉ coi là sẵn sàng khi ĐỌC ĐƯỢC dòng khởi động
 * trên stdout của tiến trình con.
 */
export async function startApi({ port = 4791, env = {} } = {}) {
  if (await portBusy(port)) {
    const alt = await freePort();
    console.warn(`⚠️  Cổng ${port} đang bị tiến trình khác chiếm (không phải của bộ test) — chuyển sang cổng ${alt}.`);
    port = alt;
  }
  const dataDir = path.join(apiRoot, 'tmp', `test-data-${port}`);
  fs.mkdirSync(path.join(dataDir, 'releases'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      MONGO_URL: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/zca_dev',
      JWT_SECRET: process.env.JWT_SECRET ?? 'dev',
      PUBLIC_URL: base,
      RELEASES_DIR: path.join(dataDir, 'releases'),
      UPLOADS_DIR: path.join(dataDir, 'uploads'),
      CORS_ORIGINS: 'http://localhost:4790',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = [];
  const collect = (buf) => { for (const l of String(buf).split('\n')) if (l.trim()) lines.push(l); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`API con thoát sớm (mã ${child.exitCode}):\n${lines.join('\n')}`);
    // Dấu hiệu sẵn sàng phải đến từ CHÍNH tiến trình con, không phải từ ai đó đang nghe cổng này.
    if (lines.some((l) => l.includes('[khởi động] API sẵn sàng'))) {
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) return { base, lines, dataDir, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000); }) };
      } catch { /* chưa nhận kết nối */ }
    }
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error(`API không lên sau 15 giây:\n${lines.join('\n')}`);
}

/** Gọi API, luôn trả { status, headers, body } — kể cả khi lỗi, để test tự khẳng định mã HTTP. */
export function makeClient(base) {
  return async function call(pathname, { method = 'GET', body, token, form, headers = {}, raw = false } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (form) init.body = form;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }

    const res = await fetch(`${base}${pathname}`, init);
    if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }
    return { status: res.status, headers: res.headers, body: parsed };
  };
}

/** Bộ chạy test tuần tự, in kết quả từng ca. */
export function createRunner(title) {
  const results = [];
  let group = '';

  const runner = {
    section(name) { group = name; console.log(`\n\x1b[1m── ${name} ─────────────────────────────\x1b[0m`); },
    async test(name, fn) {
      try {
        await fn();
        results.push({ group, name, ok: true });
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      } catch (err) {
        results.push({ group, name, ok: false, err });
        console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err?.message ?? err}`);
      }
    },
    summary() {
      const passed = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      console.log(`\n\x1b[1m${title}: ${passed}/${results.length} ca QUA\x1b[0m`);
      if (failed.length) {
        console.log('\x1b[31mCa KHÔNG QUA:\x1b[0m');
        for (const f of failed) console.log(`  - [${f.group}] ${f.name}: ${f.err?.message ?? f.err}`);
      }
      return failed.length === 0;
    },
  };
  return runner;
}

/** Khẳng định gọn — thông báo lỗi nói rõ mong đợi gì, nhận được gì. */
export function assert(cond, message) {
  if (!cond) throw new Error(message);
}
export function assertEq(actual, expected, what = 'giá trị') {
  if (actual !== expected) throw new Error(`${what}: mong đợi ${JSON.stringify(expected)}, nhận ${JSON.stringify(actual)}`);
}
export function assertStatus(res, expected, what = '') {
  if (res.status !== expected) {
    throw new Error(`${what} mã HTTP: mong đợi ${expected}, nhận ${res.status} — ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
}

export const rand = (n = 6) => Math.random().toString(36).slice(2, 2 + n);

/**
 * Mỗi lần chạy test một DATABASE RIÊNG rồi xoá đi.
 * Dùng chung một database giữa các lần chạy làm kết quả phụ thuộc lịch sử: slug bài viết bị thêm hậu tố
 * `-2`, số quản trị viên cộng dồn khiến luật "không hạ quyền admin cuối cùng" không kích hoạt… Những ca
 * "trượt" kiểu đó tốn thời gian đi soi API trong khi API không sai.
 */
export function testMongoUrl(prefix = 'zca_test') {
  const baseUrl = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/zca_dev';
  const [withoutQuery, query] = baseUrl.split('?');
  const root = withoutQuery.replace(/\/[^/]*$/, '');
  return `${root}/${prefix}_${rand(8)}${query ? `?${query}` : ''}`;
}

export async function dropDb(url) {
  const { default: mongoose } = await import('mongoose');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
}
