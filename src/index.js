/** Điểm vào chế độ Node thuần: chạy lõi rồi mở trình duyệt. */
import { spawn } from 'node:child_process';
import { startApp } from './app.js';
import { PORT, HOST, OPEN_BROWSER } from './config.js';

const url = `http://${HOST}:${PORT}/`;

function openBrowser() {
  if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  else console.log(`Mở trình duyệt tại ${url}`);
}

try {
  const app = await startApp();
  if (OPEN_BROWSER) openBrowser();
  const shutdown = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => app.log.error(`uncaughtException: ${err?.stack ?? err}`));
  process.on('unhandledRejection', (err) => app.log.error(`unhandledRejection: ${err?.stack ?? err}`));
} catch (err) {
  if (err?.code === 'EADDRINUSE') {
    console.log(`Ứng dụng đã chạy sẵn — mở lại giao diện tại ${url}`);
    openBrowser();
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
}
