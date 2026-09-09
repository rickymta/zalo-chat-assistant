/**
 * Danh mục model GGUF dùng được trong ứng dụng + tải model về data/models/ (có tiếp tục tải khi bị ngắt, kiểm SHA-256).
 * Chọn theo RAM: máy 8 GB chỉ nên dùng model ~3B ở Q4 (chiếm ~2–2,5 GB RAM); 16 GB mới lên 7B.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Mặc định: Qwen3 4B Instruct 2507 Q4_K_M — so sánh 09/09/2026 trên hội thoại thật: phân loại quan hệ đúng, không bịa, câu trả lời đúng giọng;
 *  chậm hơn Gemma 4 E2B ~2,5 lần nhưng chất lượng quyết định giá trị bản tin. */
export const DEFAULT_MODEL_URL = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';

export const KNOWN_MODELS = [
  { id: 'qwen3-4b-2507-q4', label: 'Qwen3 4B Instruct 2507 · Q4_K_M · 2,5 GB — khuyên dùng (chất lượng tốt nhất trong tầm 8 GB)', url: DEFAULT_MODEL_URL, ram: 8 },
  { id: 'gemma-4-e2b-q4', label: 'Gemma 4 E2B it · Q4_K_M · 3,1 GB — nhanh gấp 2,5 lần, thi thoảng phân loại nhầm', url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf', ram: 8 },
  { id: 'gemma-3-4b-q4', label: 'Gemma 3 4B it · Q4_K_M · 2,5 GB — an toàn nhưng tóm tắt nông', url: 'https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf', ram: 8 },
  { id: 'qwen2.5-3b-q4', label: 'Qwen2.5 3B Instruct · Q4_K_M · 2,1 GB — nhẹ nhất, hay bịa (không khuyên dùng)', url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf', ram: 8 },
  { id: 'qwen2.5-7b-q4', label: 'Qwen2.5 7B Instruct · Q4_K_M · 4,7 GB — cần máy 16 GB', url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf', ram: 16 },
];

export function fileNameFromUrl(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || null; } catch { return null; }
}

/** Đường dẫn tệp model theo cấu hình nếu đã có trên máy (ưu tiên aiModelPath, rồi tệp cùng tên với URL trong data/models/). */
export function findModelFile({ modelsDir, settings }) {
  const p = String(settings?.aiModelPath || '').trim();
  if (p && fs.existsSync(p)) return p;
  const name = fileNameFromUrl(settings?.aiModelUrl || DEFAULT_MODEL_URL);
  if (!name) return null;
  const local = path.join(modelsDir, name);
  return fs.existsSync(local) ? local : null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/**
 * Tải model về modelsDir. Tệp dở lưu <tên>.part và được tiếp tục (HTTP Range) ở lần sau. Hugging Face trả SHA-256 của tệp
 * trong header X-Linked-ETag ⇒ đối chiếu khi có. onProgress({ received, total, progress }).
 */
export async function downloadModel({ url, modelsDir, onProgress, signal, log }) {
  if (!/^https:\/\//i.test(String(url))) throw new Error('URL model phải bắt đầu bằng https://');
  fs.mkdirSync(modelsDir, { recursive: true });
  const name = fileNameFromUrl(url);
  if (!name || !/\.gguf$/i.test(name)) throw new Error('URL phải trỏ tới một tệp .gguf');
  const dest = path.join(modelsDir, name);
  if (fs.existsSync(dest)) return { file: dest, skipped: true };
  const part = dest + '.part';
  let start = 0;
  try { start = fs.statSync(part).size; } catch { start = 0; }

  const headers = { 'User-Agent': 'zalo-chat-assistant' };
  if (start > 0) headers.Range = `bytes=${start}-`;
  const res = await fetch(url, { headers, redirect: 'follow', signal });
  if (res.status === 416) { fs.rmSync(part, { force: true }); return downloadModel({ url, modelsDir, onProgress, signal, log }); }
  if (!res.ok) throw new Error(`Máy chủ trả ${res.status} khi tải model.`);
  if (res.status === 200 && start > 0) { start = 0; fs.rmSync(part, { force: true }); }
  const len = Number(res.headers.get('content-length'));
  const total = Number.isFinite(len) && len > 0 ? start + len : null;
  const etag = String(res.headers.get('x-linked-etag') || res.headers.get('etag') || '').replace(/"/g, '').replace(/^W\//, '');
  const expectSha = /^[0-9a-f]{64}$/i.test(etag) ? etag.toLowerCase() : null;

  let received = start; let last = 0;
  const counter = new Transform({
    transform(chunk, _e, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - last > 300) { last = now; onProgress?.({ received, total, progress: total ? received / total : 0 }); }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: start ? 'a' : 'w' }));
  onProgress?.({ received, total: total ?? received, progress: 1 });
  if (total && received !== total) throw new Error(`Tải thiếu: nhận ${received}/${total} byte — hãy bấm Tải model lần nữa để tiếp tục.`);
  if (expectSha) {
    const sum = await sha256File(part);
    if (sum !== expectSha) { fs.rmSync(part, { force: true }); throw new Error('Tệp model không khớp SHA-256 công bố — đã xoá, hãy tải lại.'); }
  }
  fs.renameSync(part, dest);
  log?.info(`Đã tải model ${name} (${received} byte${expectSha ? ', SHA-256 khớp' : ''}).`);
  return { file: dest, skipped: false };
}

export function listLocalModels(modelsDir) {
  try { return fs.readdirSync(modelsDir).filter((f) => /\.gguf$/i.test(f)).map((f) => ({ file: path.join(modelsDir, f), name: f, size: fs.statSync(path.join(modelsDir, f)).size })); } catch { return []; }
}
