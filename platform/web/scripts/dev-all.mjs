#!/usr/bin/env node
/**
 * Chạy một lệnh duy nhất cho cả máy chủ mock (4791) và Vite (5174).
 *   npm run dev:all
 * Ctrl+C tắt cả hai. Muốn chạy riêng: `npm run mock` và `npm run dev` ở hai cửa sổ.
 */

import { spawn } from 'node:child_process';

const children = [];

function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach((l) => out.write(prefix + l + '\n'));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}kết thúc (mã ${code})\n`);
    stopAll();
    process.exit(code ?? 0);
  });
  children.push(child);
  return child;
}

function stopAll() {
  children.forEach((c) => {
    if (!c.killed) c.kill('SIGTERM');
  });
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

run('mock', process.execPath, ['scripts/mock-api.mjs']);
run('vite', 'npx', ['vite', '--port', '5174', '--strictPort']);
