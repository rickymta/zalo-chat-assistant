/**
 * So sánh semver rút gọn ("1.2.0", "1.2.0-beta.1"). Không kéo thêm thư viện cho một việc nhỏ.
 * Trả về <0 nếu a < b, 0 nếu bằng, >0 nếu a > b. Chuỗi không hợp lệ coi như 0.0.0.
 */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
  if (!m) return { nums: [0, 0, 0], pre: null };
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

export function cmpSemver(a, b) {
  const pa = parse(a); const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // Bản có hậu tố tiền phát hành (-beta.1) THẤP hơn bản chính thức cùng số.
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ta = pa.pre.split('.'); const tb = pb.pre.split('.');
  for (let i = 0; i < Math.max(ta.length, tb.length); i += 1) {
    const x = ta[i]; const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x); const ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function isValidSemver(v) {
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(v ?? '').trim());
}
