/**
 * Kiểm tra bản cập nhật; từ 0.0.2 tải bộ cài trong ứng dụng, đối chiếu SHA-256 rồi nhờ vỏ Electron cài (platform.installUpdate).
 * Bản chưa ký nên không dùng autoUpdater của Electron (macOS bắt buộc chữ ký); Node thuần chỉ báo và mở trình duyệt.
 *
 * Hợp đồng: platform/API-CONTRACT.md mục 3 và 6.
 *   GET <máy chủ>/api/releases/check?platform=&arch=&version=&channel=stable
 *   → { updateAvailable, current, latest: Release|null, mandatory }
 *
 * Máy chủ cập nhật = `settings.updateServerUrl` nếu người dùng đặt, ngược lại máy chủ tài khoản (`auth.serverUrl`);
 * chế độ dùng thử (`auth.mode === 'local'`) không có máy chủ riêng nên vẫn dùng `auth.serverUrl` mặc định.
 *
 * Nguyên tắc: mạng hỏng KHÔNG được làm ứng dụng lỗi — mọi thất bại chỉ ghi log warn + `lastError`, giao diện vẫn chạy.
 * Kết quả lần cuối ghi ra `data/update.json` để lần mở sau còn nhớ (không phải chờ kiểm tra lại mới hiện thanh báo).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './config.js';

/** Chờ máy chủ tối đa 10 giây — lâu hơn coi như không kết nối được. */
const TIMEOUT_MS = 10_000;
/** Kiểm tra lần đầu 20 giây sau khi khởi động (để không giành băng thông với lúc khôi phục phiên Zalo). */
const FIRST_DELAY_MS = 20_000;
/** Rồi mỗi 6 giờ. */
const PERIOD_MS = 6 * 3600e3;
/** Chặn ghi chú phát hành quá dài (máy chủ lạ / lỗi) làm phình file và giao diện. */
const MAX_NOTES = 40_000;
/** Tải bộ cài (~100–130 MB) có thể lâu trên mạng chậm — cho tối đa 30 phút rồi mới coi là hỏng. */
const DOWNLOAD_TIMEOUT_MS = 30 * 60e3;
/** Thư mục chứa bộ cài đã tải; mỗi lần tải mới sẽ dọn tệp cũ. */
const UPDATES_DIR = path.join(DATA_DIR, 'updates');

function emptyInstall() {
  return { phase: 'idle', progress: 0, received: 0, total: null, file: null, version: null, error: null, manual: false };
}
/** Tên tệp lấy từ URL (đã lọc ký tự lạ); không đoán được thì đặt theo phiên bản + đuôi theo hệ. */
function safeFileName(url, version) {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* URL lạ */ }
  name = name.replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  if (!/\.(dmg|exe|zip|pkg|msi)$/i.test(name)) name = `update-${version}${process.platform === 'win32' ? '.exe' : '.dmg'}`;
  return name;
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function semverParts(v) {
  const m = String(v ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

/**
 * So sánh semver tự viết (không thêm thư viện): -1 nếu a < b, 0 nếu bằng, 1 nếu a > b.
 * Chuỗi không đọc được ⇒ 0 (coi như bằng) để không bao giờ báo nhầm "có bản mới".
 */
export function compareSemver(a, b) {
  const pa = semverParts(a); const pb = semverParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;      // 1.0.0 > 1.0.0-beta
  if (pb.pre === null) return -1;
  const A = pa.pre.split('.'); const B = pb.pre.split('.');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i]; const y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x); const ny = /^\d+$/.test(y);
    if (nx && ny) { if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Chỉ giữ đúng các trường giao diện cần, ép kiểu an toàn — máy chủ trả gì thừa cũng không lọt vào state. */
function normalizeRelease(r) {
  if (!r || typeof r !== 'object') return null;
  const version = String(r.version ?? '').trim();
  if (!semverParts(version)) return null;
  const url = String(r.downloadUrl ?? r.externalUrl ?? '').trim();
  return {
    version,
    notes: String(r.notes ?? '').slice(0, MAX_NOTES),
    notesHtml: String(r.notesHtml ?? '').slice(0, MAX_NOTES),
    downloadUrl: /^https?:\/\//i.test(url) ? url : '',
    fileSize: Number.isFinite(Number(r.fileSize)) ? Number(r.fileSize) : null,
    sha256: String(r.sha256 ?? '').slice(0, 128),
    mandatory: !!r.mandatory,
    publishedAt: Number.isFinite(Number(r.publishedAt)) ? Number(r.publishedAt) : null,
  };
}

export function createUpdater({ auth, settings, platform, log, events, version }) {
  const stateFile = path.join(DATA_DIR, 'update.json');
  const current = String(version || platform?.appVersion || '0.0.0');
  /** Tự cài được khi vỏ Electron cung cấp installUpdate (macOS: đổi bundle từ DMG; Windows: chạy Setup ngầm). Node thuần: không. */
  const canInstall = typeof platform?.installUpdate === 'function' && (process.platform === 'darwin' || process.platform === 'win32');

  const state = {
    checking: false,
    lastCheckAt: null,
    lastError: null,
    current,
    /** Có bản mới hơn bản đang chạy (KHÔNG xét việc người dùng đã bỏ qua) — dùng cho thẻ Cài đặt. */
    newer: false,
    /** Có bản mới VÀ chưa bị bỏ qua (hoặc bắt buộc) — dùng cho thanh báo trên cùng. */
    available: false,
    latest: null,
    mandatory: false,
    skippedVersion: '',
    canInstall,
    /** Tiến trình tải + cài bản mới ngay trong ứng dụng (không lưu ra file — mở lại là bắt đầu lại). */
    install: emptyInstall(),
  };

  let firstTimer = null;
  let periodTimer = null;

  const emit = () => { try { events?.emit('update', status()); } catch { /* bỏ qua */ } };

  function status() {
    return { ...state, latest: state.latest ? { ...state.latest } : null, install: { ...state.install } };
  }

  /** Bản đã bỏ qua thì không hiện thanh báo nữa — trừ khi bản đó bắt buộc. */
  function recompute() {
    state.skippedVersion = String(settings.load().skippedVersion || '');
    const l = state.latest;
    state.newer = !!l && compareSemver(l.version, state.current) > 0;
    if (!state.newer) { state.available = false; state.mandatory = false; return; }
    state.available = state.mandatory || l.version !== state.skippedVersion;
  }

  function persist() {
    try {
      fs.writeFileSync(stateFile, JSON.stringify({
        current: state.current, lastCheckAt: state.lastCheckAt, lastError: state.lastError,
        latest: state.latest, mandatory: state.mandatory,
      }, null, 2));
    } catch { /* không ghi được thì thôi, lần sau kiểm tra lại */ }
  }

  function restore() {
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      // Ứng dụng đã được cập nhật kể từ lần ghi ⇒ bỏ kết quả cũ, chờ lượt kiểm tra mới.
      if (String(j.current ?? '') === state.current) {
        state.lastCheckAt = Number.isFinite(Number(j.lastCheckAt)) ? Number(j.lastCheckAt) : null;
        state.lastError = j.lastError ? String(j.lastError) : null;
        state.latest = normalizeRelease(j.latest);
        state.mandatory = !!j.mandatory;
      }
    } catch { /* chưa có file — bình thường */ }
    recompute();
  }

  /** Máy chủ cập nhật đang dùng: thiết lập riêng nếu có, ngược lại máy chủ tài khoản. */
  function serverUrl() {
    const custom = String(settings.load().updateServerUrl || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(custom)) return custom;
    return String(auth?.serverUrl || '').replace(/\/+$/, '');
  }

  /** Chuyển lỗi mạng của Node thành câu người dùng đọc được. */
  function friendly(err) {
    const code = err?.cause?.code ?? '';
    if (err?.name === 'TimeoutError') return 'Tải quá lâu (hơn 30 phút) — kiểm tra mạng rồi thử lại.';
    if (err?.name === 'TypeError' || code) return `Không kết nối được máy chủ tải về${code ? ` (${code})` : ''}.`;
    return err?.message ?? String(err);
  }

  /**
   * Tải bộ cài của bản mới nhất về DATA_DIR/updates rồi đối chiếu SHA-256 công bố. Chạy nền; giao diện theo dõi qua status().
   * Không có SHA-256 từ máy chủ thì KHÔNG cài (không thể biết tệp còn nguyên hay không) — đẩy người dùng sang tải bằng trình duyệt.
   */
  async function download() {
    const l = state.latest;
    if (!state.newer || !l?.downloadUrl) throw Object.assign(new Error('Chưa có bản cập nhật để tải.'), { status: 400 });
    if (!canInstall) throw Object.assign(new Error('Máy này chưa tự cài được — hãy tải bằng trình duyệt.'), { status: 501 });
    if (['downloading', 'verifying', 'installing'].includes(state.install.phase)) return status();
    if (!/^[0-9a-f]{64}$/i.test(l.sha256 || '')) {
      state.install = { ...emptyInstall(), phase: 'error', version: l.version, manual: true, error: 'Máy chủ không công bố SHA-256 cho bản này nên không tự cài được.' };
      emit(); return status();
    }
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    const file = path.join(UPDATES_DIR, safeFileName(l.downloadUrl, l.version));
    // Đã tải xong lần trước (cùng nội dung) ⇒ dùng lại, không tải nữa.
    try {
      if (fs.existsSync(file) && (await sha256File(file)).toLowerCase() === l.sha256.toLowerCase()) {
        const size = fs.statSync(file).size;
        state.install = { ...emptyInstall(), phase: 'ready', progress: 1, received: size, total: size, file, version: l.version };
        emit(); return status();
      }
    } catch { /* tệp hỏng ⇒ tải lại */ }
    for (const n of fs.readdirSync(UPDATES_DIR)) { try { fs.rmSync(path.join(UPDATES_DIR, n), { recursive: true, force: true }); } catch { /* bỏ qua */ } }
    state.install = { ...emptyInstall(), phase: 'downloading', version: l.version, total: l.fileSize || null, file };
    emit();
    const tmp = file + '.part';
    (async () => {
      try {
        const res = await fetch(l.downloadUrl, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!res.ok || !res.body) throw new Error(`Máy chủ trả lỗi ${res.status} khi tải tệp.`);
        const len = Number(res.headers.get('content-length'));
        if (Number.isFinite(len) && len > 0) state.install.total = len;
        let lastEmit = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            state.install.received += chunk.length;
            if (state.install.total) state.install.progress = Math.min(0.999, state.install.received / state.install.total);
            const now = Date.now();
            if (now - lastEmit > 400) { lastEmit = now; emit(); }
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
        state.install.phase = 'verifying'; emit();
        const sum = await sha256File(tmp);
        if (sum.toLowerCase() !== l.sha256.toLowerCase()) {
          fs.rmSync(tmp, { force: true });
          throw new Error('Tệp tải về không khớp SHA-256 công bố (có thể tải lỗi giữa chừng) — hãy thử lại.');
        }
        fs.renameSync(tmp, file);
        state.install.phase = 'ready'; state.install.progress = 1;
        log.info(`Đã tải bản ${l.version} (${state.install.received} byte, SHA-256 khớp) — chờ người dùng bấm cài.`);
      } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* bỏ qua */ }
        state.install.phase = 'error'; state.install.error = friendly(err);
        log.warn(`Không tải được bản ${l.version}: ${state.install.error}`);
      } finally {
        emit();
      }
    })();
    return status();
  }

  /** Cài tệp đã tải (đối chiếu SHA-256 lần nữa ngay trước khi cài) rồi để vỏ Electron thay ứng dụng và mở lại. */
  async function install() {
    const it = state.install;
    if (it.phase !== 'ready' || !it.file || !fs.existsSync(it.file)) throw Object.assign(new Error('Chưa tải xong bản cập nhật.'), { status: 400 });
    const sum = await sha256File(it.file);
    if (sum.toLowerCase() !== String(state.latest?.sha256 || '').toLowerCase()) {
      state.install = { ...emptyInstall(), phase: 'error', version: it.version, error: 'Tệp đã tải không còn khớp SHA-256 — hãy tải lại.' };
      emit(); return status();
    }
    state.install.phase = 'installing'; emit();
    try {
      const r = await platform.installUpdate({ file: it.file, version: it.version });
      if (r?.manual) {
        state.install.phase = 'error'; state.install.manual = true;
        state.install.error = r.reason || 'Không tự cài được trên máy này.';
        log.warn(`Không tự cài được bản ${it.version}: ${state.install.error}`);
      } else {
        log.info(`Đang cài bản ${it.version} — ứng dụng sẽ tự đóng và mở lại.`);
      }
    } catch (err) {
      state.install.phase = 'error'; state.install.error = err?.message ?? String(err);
      log.warn(`Lỗi khi cài bản ${it.version}: ${state.install.error}`);
    }
    emit();
    return status();
  }

  const updater = {
    serverUrl,
    status,
    download,
    install,

    /**
     * Hỏi máy chủ có bản mới không. `manual` = người dùng bấm nút (bỏ qua công tắc tự kiểm tra).
     * Không bao giờ ném lỗi ra ngoài.
     */
    async check({ manual = false } = {}) {
      if (!manual && settings.load().autoCheckUpdates === false) return status();
      if (state.checking) return status();
      const base = serverUrl();
      state.checking = true;
      emit();
      try {
        if (!base) throw new Error('Chưa có địa chỉ máy chủ cập nhật.');
        const url = `${base}/api/releases/check?platform=${encodeURIComponent(process.platform)}&arch=${encodeURIComponent(process.arch)}&version=${encodeURIComponent(state.current)}&channel=stable`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
        const data = await res.json();
        const latest = normalizeRelease(data?.latest);
        state.latest = latest;
        // Máy chủ đổi sang bản khác trong lúc đã tải xong bản cũ ⇒ bỏ tệp cũ, chờ người dùng tải lại.
        if (!['idle', 'downloading', 'verifying', 'installing'].includes(state.install.phase) && state.install.version !== latest?.version) state.install = emptyInstall();
        // So semver tại đây là nguồn sự thật; cờ mandatory lấy theo máy chủ (nó còn xét minVersion).
        state.mandatory = !!latest && compareSemver(latest.version, state.current) > 0 && (!!data?.mandatory || !!latest.mandatory);
        state.lastError = null;
        recompute();
        if (state.newer) log.info(`Có bản cập nhật ${latest.version} (đang dùng ${state.current})${state.mandatory ? ' — BẮT BUỘC' : ''}.`);
        else log.info(`Đã kiểm tra cập nhật: đang dùng bản mới nhất (${state.current}).`);
      } catch (err) {
        // Câu chữ hiển thị thẳng cho người dùng ⇒ tránh để lọt "fetch failed" trần của Node.
        const code = err?.cause?.code ?? '';
        if (err?.name === 'TimeoutError') state.lastError = `Máy chủ cập nhật không trả lời trong ${TIMEOUT_MS / 1000} giây.`;
        else if (err?.name === 'TypeError' || code) state.lastError = `Không kết nối được máy chủ cập nhật ${base}${code ? ` (${code})` : ''}.`;
        else state.lastError = err?.message ?? String(err);
        log.warn(`Không kiểm tra được bản cập nhật tại ${base || '(chưa đặt)'}: ${state.lastError}`);
      } finally {
        state.checking = false;
        state.lastCheckAt = Date.now();
        persist();
        emit();
      }
      return status();
    },

    /** Bỏ qua một phiên bản — lưu vào thiết lập để lần mở sau vẫn nhớ. Bản bắt buộc thì không cho bỏ. */
    skip(v) {
      const target = String(v || state.latest?.version || '').trim();
      if (!target) throw Object.assign(new Error('Chưa biết bỏ qua bản nào.'), { status: 400 });
      if (state.mandatory && state.latest?.version === target) {
        throw Object.assign(new Error('Bản cập nhật này là bắt buộc — không bỏ qua được.'), { status: 400 });
      }
      settings.save({ skippedVersion: target });
      recompute();
      log.info(`Người dùng bỏ qua bản cập nhật ${target}.`);
      persist();
      emit();
      return status();
    },

    /**
     * Hẹn lịch kiểm tra: 20 giây sau khi khởi động rồi mỗi 6 giờ.
     * `initial: false` dùng khi người dùng vừa đổi thiết lập — chỉ đặt lại chu kỳ, không kiểm tra ngay.
     */
    schedule({ initial = true } = {}) {
      updater.stop();
      if (settings.load().autoCheckUpdates === false) { log.info('Tự kiểm tra cập nhật đang TẮT.'); return; }
      if (initial) firstTimer = setTimeout(() => { firstTimer = null; void updater.check({}); }, FIRST_DELAY_MS);
      periodTimer = setInterval(() => { void updater.check({}); }, PERIOD_MS);
    },

    stop() {
      if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
      if (periodTimer) { clearInterval(periodTimer); periodTimer = null; }
    },
  };

  restore();
  return updater;
}
