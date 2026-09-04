/**
 * Logger tối giản: in ra console, ghi thêm vào data/app.log và giữ ~300 dòng gần nhất cho giao diện.
 * Không dùng thư viện ngoài để giảm thứ phải cài.
 */
import fs from 'node:fs';

function stamp() {
  return new Date().toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}

function toText(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
}

export function createLogger(filePath, ringSize = 300) {
  const ring = [];
  let stream = null;
  try {
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    stream.on('error', () => { stream = null; });
  } catch {
    stream = null;
  }

  function write(level, args) {
    const line = `[${stamp()}] ${level.toUpperCase().padEnd(5)} ${toText(args)}`;
    ring.push({ ts: Date.now(), level, message: toText(args) });
    if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
    (level === 'error' ? console.error : console.log)(line);
    if (stream) stream.write(line + '\n');
  }

  return {
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    /** Dòng gần nhất cho giao diện (mới nhất ở cuối). */
    recent: (n = 100) => ring.slice(-n),
  };
}
