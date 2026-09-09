/**
 * Bộ máy AI cục bộ: chạy model GGUF ngay trong tiến trình ứng dụng bằng node-llama-cpp (Metal trên Apple Silicon).
 *
 * - Nạp model khi cần, GIẢI PHÓNG sau N phút rảnh (máy 8 GB không nên giữ 2,5 GB RAM suốt ngày).
 * - Mọi yêu cầu sinh chữ đi qua MỘT hàng đợi tuần tự (một context, một sequence) — không chạy song song.
 * - Đầu ra ép theo JSON schema (grammar) ⇒ luôn parse được, không phải "dỗ" model.
 * - Không ghi log nội dung hội thoại; chỉ ghi số liệu (thời gian, token).
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { downloadModel, findModelFile } from './models.js';

/**
 * Đầu ra bị cắt ở giới hạn token thì JSON không đóng: cắt về sau thuộc tính cấp 1 hoàn chỉnh cuối cùng rồi đóng ngoặc.
 * Grammar sinh khoá theo thứ tự schema nên phần còn lại vẫn đúng cấu trúc; khoá thiếu do tầng chuẩn hoá điền mặc định.
 */
export function repairTruncatedJson(text) {
  const t = String(text ?? '');
  let depth = 0; let inStr = false; let esc = false; let lastGood = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') { depth -= 1; if (depth === 1) lastGood = i; }
    else if (ch === ',' && depth === 1) lastGood = i - 1;
  }
  if (lastGood < 0) return null;
  const head = t.slice(0, lastGood + 1).replace(/,\s*$/, '');
  try { return JSON.parse(head + '}'); } catch { return null; }
}

export class LocalEngine extends EventEmitter {
  constructor({ log, settings, modelsDir }) {
    super();
    this.log = log; this.settings = settings; this.modelsDir = modelsDir;
    this.llama = null; this.model = null; this.context = null;
    this.loadingPromise = null; this.idleTimer = null; this.chain = Promise.resolve();
    this.downloadAbort = null;
    this.state = {
      loading: false, loaded: false, busy: false, queue: 0, modelPath: null, modelName: null, gpu: null, contextSize: null,
      lastError: null, lastGenAt: null, stats: { runs: 0, tokens: 0, ms: 0 },
      download: { phase: 'idle', received: 0, total: null, progress: 0, file: null, error: null },
    };
  }

  emitChange() { try { this.emit('change', this.status()); } catch { /* bỏ qua */ } }

  status() {
    const s = this.settings.load();
    return {
      engine: s.aiEngine === 'cowork' ? 'cowork' : 'local',
      modelUrl: s.aiModelUrl, modelFile: findModelFile({ modelsDir: this.modelsDir, settings: s }), modelsDir: this.modelsDir,
      ...this.state, stats: { ...this.state.stats }, download: { ...this.state.download },
    };
  }

  /** Tải model theo cấu hình (hoặc URL truyền vào). Chạy nền; theo dõi qua status().download. */
  async download({ url } = {}) {
    if (this.state.download.phase === 'downloading') return this.status();
    const target = String(url || this.settings.load().aiModelUrl || '').trim();
    this.downloadAbort = new AbortController();
    this.state.download = { phase: 'downloading', received: 0, total: null, progress: 0, file: null, error: null };
    this.emitChange();
    try {
      const r = await downloadModel({
        url: target, modelsDir: this.modelsDir, signal: this.downloadAbort.signal, log: this.log,
        onProgress: (p) => { Object.assign(this.state.download, p); this.emitChange(); },
      });
      this.state.download.phase = 'done'; this.state.download.file = r.file; this.state.download.progress = 1;
    } catch (err) {
      this.state.download.phase = 'error';
      this.state.download.error = err?.name === 'AbortError' ? 'Đã dừng tải.' : (err?.message ?? String(err));
      this.log?.warn(`Không tải được model: ${this.state.download.error}`);
    } finally {
      this.downloadAbort = null;
      this.emitChange();
    }
    return this.status();
  }

  cancelDownload() { this.downloadAbort?.abort(); }

  /** Nạp model + tạo context (idempotent). Ném lỗi có câu người dùng đọc được khi chưa có model. */
  async load() {
    if (this.state.loaded) { this.touch(); return; }
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      const s = this.settings.load();
      const file = findModelFile({ modelsDir: this.modelsDir, settings: s });
      if (!file) throw Object.assign(new Error('Chưa có model trên máy — vào Cài đặt → Bộ máy tổng hợp AI → Tải model.'), { status: 400 });
      this.state.loading = true; this.state.lastError = null; this.emitChange();
      const t0 = Date.now();
      try {
        const { getLlama } = await import('node-llama-cpp');
        this.llama ??= await getLlama({ gpu: 'auto' });
        this.model = await this.llama.loadModel({ modelPath: file, gpuLayers: 'auto' });
        const want = Math.max(2048, Math.min(Number(s.aiContextSize) || 8192, this.model.trainContextSize || 8192));
        this.context = await this.model.createContext({ contextSize: want, sequences: 1 });
        this.state.loaded = true; this.state.modelPath = file; this.state.modelName = path.basename(file);
        this.state.gpu = this.llama.gpu || 'cpu'; this.state.contextSize = this.context.contextSize;
        this.log?.info(`AI cục bộ: đã nạp ${this.state.modelName} (${this.state.gpu}, ngữ cảnh ${this.state.contextSize}) sau ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
      } catch (err) {
        this.state.lastError = err?.message ?? String(err);
        this.log?.error(`AI cục bộ: không nạp được model: ${this.state.lastError}`);
        await this.unload().catch(() => {});
        throw err;
      } finally {
        this.state.loading = false; this.loadingPromise = null; this.emitChange();
      }
      this.touch();
    })();
    return this.loadingPromise;
  }

  /** Giải phóng model khỏi RAM sau khi rảnh N phút (0 = giữ luôn). */
  touch() {
    clearTimeout(this.idleTimer);
    const mins = Number(this.settings.load().aiIdleUnloadMinutes ?? 10);
    if (!mins) return;
    this.idleTimer = setTimeout(() => { if (!this.state.busy && !this.state.queue) void this.unload('rảnh'); }, mins * 60e3);
  }

  async unload(reason = '') {
    clearTimeout(this.idleTimer);
    const had = this.state.loaded;
    try { await this.context?.dispose(); } catch { /* bỏ qua */ }
    try { await this.model?.dispose(); } catch { /* bỏ qua */ }
    this.context = null; this.model = null;
    this.state.loaded = false; this.state.contextSize = null;
    if (had) this.log?.info(`AI cục bộ: đã giải phóng model${reason ? ` (${reason})` : ''}.`);
    this.emitChange();
  }

  /** Hàng đợi tuần tự. */
  enqueue(fn) {
    this.state.queue += 1;
    const run = this.chain.then(fn, fn);
    this.chain = run.then(() => {}, () => {});
    return run.finally(() => { this.state.queue = Math.max(0, this.state.queue - 1); });
  }

  /** Lấy sequence trống; context hết sequence (rò từ lượt trước) thì dựng lại context rồi lấy lại. */
  async acquireSequence() {
    try { return this.context.getSequence(); } catch (err) {
      if (!/No sequences left/i.test(String(err?.message))) throw err;
      this.log?.warn('AI cục bộ: context hết sequence — dựng lại context.');
      const size = this.state.contextSize || Number(this.settings.load().aiContextSize) || 8192;
      try { await this.context?.dispose(); } catch { /* bỏ qua */ }
      this.context = await this.model.createContext({ contextSize: size, sequences: 1 });
      return this.context.getSequence();
    }
  }

  /** Trả sequence về context (chờ xong) — không chờ là lượt kế "No sequences left". */
  async releaseSession(session, seq) {
    try { await session.dispose({ disposeSequence: true }); } catch { /* bỏ qua */ }
    try { if (!seq.disposed) await seq.dispose(); } catch { /* bỏ qua */ }
  }

  /** Đếm token bằng tokenizer của model (phải nạp trước); chưa nạp thì ước lượng ~3 ký tự/token cho tiếng Việt. */
  tokenCount(text) {
    try { if (this.model) return this.model.tokenize(String(text)).length; } catch { /* rơi xuống ước lượng */ }
    return Math.ceil(String(text).length / 3);
  }

  /** Sinh JSON theo schema (grammar). Trả về object đã parse. */
  generateJson({ system, user, schema, maxTokens = 1200, temperature = 0.2 }) {
    return this.enqueue(async () => {
      await this.load();
      const { LlamaChatSession } = await import('node-llama-cpp');
      this.state.busy = true; this.emitChange();
      const seq = await this.acquireSequence();
      const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: system });
      const t0 = Date.now();
      try {
        const grammar = await this.llama.createGrammarForJsonSchema(schema);
        const text = await session.prompt(user, { grammar, maxTokens, temperature, repeatPenalty: { penalty: 1.12, frequencyPenalty: 0.1, presencePenalty: 0.1 } });
        let out;
        try { out = grammar.parse(text); }
        catch (err) {
          // Cắt ở maxTokens ⇒ cứu phần đã sinh thay vì bỏ cả hội thoại.
          out = repairTruncatedJson(text);
          if (!out) throw err;
          out.__truncated = true;
          this.log?.warn(`AI cục bộ: đầu ra bị cắt ở ${maxTokens} token — dùng phần đã sinh (${Object.keys(out).length} trường).`);
        }
        const ms = Date.now() - t0; const toks = this.tokenCount(text);
        this.state.stats.runs += 1; this.state.stats.tokens += toks; this.state.stats.ms += ms; this.state.lastGenAt = Date.now();
        return out;
      } catch (err) {
        this.state.lastError = err?.message ?? String(err);
        throw err;
      } finally {
        await this.releaseSession(session, seq);
        this.state.busy = false; this.emitChange(); this.touch();
      }
    });
  }

  /** Sinh văn bản tự do (dùng cho bản tin đọc). */
  generateText({ system, user, maxTokens = 900, temperature = 0.4 }) {
    return this.enqueue(async () => {
      await this.load();
      const { LlamaChatSession } = await import('node-llama-cpp');
      this.state.busy = true; this.emitChange();
      const seq = await this.acquireSequence();
      const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: system });
      const t0 = Date.now();
      try {
        const text = await session.prompt(user, { maxTokens, temperature, repeatPenalty: { penalty: 1.08 } });
        this.state.stats.runs += 1; this.state.stats.tokens += this.tokenCount(text); this.state.stats.ms += Date.now() - t0; this.state.lastGenAt = Date.now();
        return String(text).trim();
      } finally {
        await this.releaseSession(session, seq);
        this.state.busy = false; this.emitChange(); this.touch();
      }
    });
  }
}
