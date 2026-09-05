/**
 * Kiểm tra bản cập nhật (KHÔNG tự tải, KHÔNG tự cài — bản chưa ký, người dùng tự tải rồi cài như lần đầu).
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
import { DATA_DIR } from './config.js';

/** Chờ máy chủ tối đa 10 giây — lâu hơn coi như không kết nối được. */
const TIMEOUT_MS = 10_000;
/** Kiểm tra lần đầu 20 giây sau khi khởi động (để không giành băng thông với lúc khôi phục phiên Zalo). */
const FIRST_DELAY_MS = 20_000;
/** Rồi mỗi 6 giờ. */
const PERIOD_MS = 6 * 3600e3;
/** Chặn ghi chú phát hành quá dài (máy chủ lạ / lỗi) làm phình file và giao diện. */
const MAX_NOTES = 40_000;

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
  };

  let firstTimer = null;
  let periodTimer = null;

  const emit = () => { try { events?.emit('update', status()); } catch { /* bỏ qua */ } };

  function status() {
    return { ...state, latest: state.latest ? { ...state.latest } : null };
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

  const updater = {
    serverUrl,
    status,

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
