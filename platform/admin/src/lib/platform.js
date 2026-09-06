/**
 * Nhận diện hệ điều hành + kiến trúc của máy đang xem web, để gợi ý đúng bản tải.
 *
 * Ưu tiên `navigator.userAgentData.getHighEntropyValues()` (Chromium) vì đây là cách duy nhất
 * phân biệt được Mac chip Apple với Mac Intel — chuỗi UA của Safari/Chrome trên macOS ARM vẫn
 * ghi "Intel Mac OS X" để tương thích ngược, không tin được.
 * Không có API đó (Safari, Firefox) ⇒ đoán bằng UA + mẹo WebGL renderer.
 */

export const PLATFORM_LABELS = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export const ARCH_LABELS = {
  arm64: 'chip Apple (M1/M2/M3…)',
  x64: 'chip Intel',
  universal: 'mọi chip',
};

/** Nhãn đầy đủ cho cặp nền tảng/kiến trúc, ví dụ "macOS · chip Apple". */
export function targetLabel(platform, arch) {
  const p = PLATFORM_LABELS[platform] || platform || 'Không rõ';
  if (!arch) return p;
  if (platform === 'win32') return arch === 'x64' ? 'Windows 64-bit' : `Windows ${arch}`;
  if (platform === 'darwin') return `${p} · ${ARCH_LABELS[arch] || arch}`;
  return `${p} · ${arch}`;
}

/** Ba đích tải chính thức của sản phẩm (khớp khoá `latest` của GET /api/site). */
export const TARGETS = [
  { key: 'darwin-arm64', platform: 'darwin', arch: 'arm64', label: 'macOS · chip Apple', ext: '.dmg' },
  { key: 'darwin-x64', platform: 'darwin', arch: 'x64', label: 'macOS · chip Intel', ext: '.dmg' },
  { key: 'win32-x64', platform: 'win32', arch: 'x64', label: 'Windows 64-bit', ext: '.exe' },
];

function guessFromUserAgent() {
  const ua = navigator.userAgent || '';
  const plat = (navigator.platform || '').toLowerCase();

  if (/Windows|Win64|WOW64/i.test(ua) || plat.startsWith('win')) {
    return { platform: 'win32', arch: 'x64', confident: true };
  }
  if (/Macintosh|Mac OS X/i.test(ua) || plat.startsWith('mac')) {
    // Mẹo phân biệt chip: GPU của Mac Apple Silicon báo "Apple M…" / "Apple GPU".
    const arch = detectMacArchByWebgl();
    return { platform: 'darwin', arch: arch || 'arm64', confident: !!arch };
  }
  if (/Android/i.test(ua)) return { platform: 'android', arch: null, confident: true };
  if (/iPhone|iPad|iPod/i.test(ua)) return { platform: 'ios', arch: null, confident: true };
  if (/Linux|X11/i.test(ua)) return { platform: 'linux', arch: 'x64', confident: true };
  return { platform: null, arch: null, confident: false };
}

function detectMacArchByWebgl() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    if (!renderer) return null;
    if (/Apple\s*(M\d|GPU)/i.test(renderer)) return 'arm64';
    if (/Intel|AMD|Radeon/i.test(renderer)) return 'x64';
    return null;
  } catch {
    return null;
  }
}

/**
 * Trả về { platform, arch, confident, label, supported }.
 * `supported` = có bản cài cho nền tảng này (điện thoại thì không).
 */
export async function detectTarget() {
  let platform = null;
  let arch = null;
  let confident = false;

  const uad = navigator.userAgentData;
  if (uad && typeof uad.getHighEntropyValues === 'function') {
    try {
      const info = await uad.getHighEntropyValues(['platform', 'architecture', 'bitness']);
      const p = String(info.platform || uad.platform || '').toLowerCase();
      if (p.includes('mac')) platform = 'darwin';
      else if (p.includes('windows')) platform = 'win32';
      else if (p.includes('linux') || p.includes('chrome os')) platform = 'linux';
      else if (p.includes('android')) platform = 'android';

      const a = String(info.architecture || '').toLowerCase();
      if (a === 'arm') arch = info.bitness === '64' ? 'arm64' : 'arm';
      else if (a === 'x86') arch = info.bitness === '64' ? 'x64' : 'x86';
      confident = !!platform && !!arch;
    } catch {
      /* Chromium từ chối high entropy values — rơi xuống đoán bằng UA */
    }
  }

  if (!platform || !arch) {
    const guess = guessFromUserAgent();
    platform = platform || guess.platform;
    arch = arch || guess.arch;
    confident = confident || guess.confident;
  }

  const supported = platform === 'darwin' || platform === 'win32';
  return {
    platform,
    arch,
    confident,
    supported,
    key: platform && arch ? `${platform}-${arch}` : null,
    label: platform ? targetLabel(platform, arch) : 'Không nhận diện được máy của bạn',
  };
}
