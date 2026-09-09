/**
 * Dò máy chủ IMAP từ địa chỉ email — để người dùng chỉ cần nhập email + mật khẩu (như ứng dụng mail của Lark chọn "Khác").
 * Thứ tự: (1) bảng nhà cung cấp quen theo tên miền; (2) bản ghi MX cho biết ai đang host mail (Google, Microsoft, Lark…);
 * (3) DNS SRV _imaps._tcp / _imap._tcp (RFC 6186); (4) thử tên quen imap.<domain>, mail.<domain>, <domain> cổng 993 rồi 143.
 * Mỗi ứng viên được thử mở kết nối TCP/TLS nhanh trước khi đăng nhập thật.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

const KNOWN = {
  'gmail.com': { host: 'imap.gmail.com', port: 993, secure: true, note: 'Gmail: cần bật IMAP và dùng Mật khẩu ứng dụng (tài khoản có xác minh 2 bước).' },
  'googlemail.com': { host: 'imap.gmail.com', port: 993, secure: true },
  'outlook.com': { host: 'outlook.office365.com', port: 993, secure: true }, 'hotmail.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'live.com': { host: 'outlook.office365.com', port: 993, secure: true }, 'msn.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'office365.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993, secure: true }, 'ymail.com': { host: 'imap.mail.yahoo.com', port: 993, secure: true },
  'icloud.com': { host: 'imap.mail.me.com', port: 993, secure: true }, 'me.com': { host: 'imap.mail.me.com', port: 993, secure: true }, 'mac.com': { host: 'imap.mail.me.com', port: 993, secure: true },
  'zoho.com': { host: 'imap.zoho.com', port: 993, secure: true }, 'yandex.com': { host: 'imap.yandex.com', port: 993, secure: true }, 'yandex.ru': { host: 'imap.yandex.com', port: 993, secure: true },
  'larksuite.com': { host: 'imap.larksuite.com', port: 993, secure: true }, 'feishu.cn': { host: 'imap.feishu.cn', port: 993, secure: true },
  'protonmail.com': null, 'proton.me': null,   // cần Proton Bridge, không dò được
};
/** Tên miền MX → máy chủ IMAP của dịch vụ đang host mail cho tên miền riêng. */
const MX_HINTS = [
  [/(^|\.)google\.com$|googlemail\.com$/i, { host: 'imap.gmail.com', port: 993, secure: true, note: 'Mail do Google Workspace host: bật IMAP trong Gmail và dùng Mật khẩu ứng dụng.' }],
  [/outlook\.com$|office365\.com$|protection\.outlook\.com$/i, { host: 'outlook.office365.com', port: 993, secure: true, note: 'Mail do Microsoft 365 host: tài khoản cần được bật IMAP và xác thực cơ bản/mật khẩu ứng dụng.' }],
  [/larksuite\.com$|lark\.com$|feishu\.cn$|larkoffice\.com$/i, { host: 'imap.larksuite.com', port: 993, secure: true, note: 'Mail do Lark host: dùng mật khẩu IMAP/SMTP tạo trong Lark Mail → Cài đặt → IMAP/SMTP.' }],
  [/zoho\.(com|eu|in)$/i, { host: 'imap.zoho.com', port: 993, secure: true }],
  [/yandex\.(net|ru|com)$/i, { host: 'imap.yandex.com', port: 993, secure: true }],
  [/mail\.me\.com$|icloud\.com$/i, { host: 'imap.mail.me.com', port: 993, secure: true }],
];

export function domainOf(email) { const m = /@([^@\s>]+)$/.exec(String(email ?? '').trim().toLowerCase()); return m ? m[1] : ''; }

/** Mở TCP (hoặc TLS) tới host:port trong ≤ timeout ms — đủ để biết cổng có mở không, không đăng nhập. */
export function probe(host, port, secure, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false; const finish = (ok) => { if (!done) { done = true; try { sock.destroy(); } catch { /* bỏ qua */ } resolve(ok); } };
    const sock = secure ? tls.connect({ host, port, servername: host, timeout }, () => finish(true)) : net.connect({ host, port, timeout }, () => finish(true));
    sock.on('error', () => finish(false)); sock.on('timeout', () => finish(false));
    setTimeout(() => finish(false), timeout + 500).unref?.();
  });
}

/** Danh sách ứng viên (đã lọc trùng), ứng viên đầu là tự tin nhất; `note` là lời khuyên riêng của nhà cung cấp. */
export async function discoverImap(email) {
  const domain = domainOf(email);
  if (!domain) throw Object.assign(new Error('Địa chỉ email không hợp lệ.'), { status: 400 });
  const out = []; const seen = new Set();
  const add = (c, reason) => { if (!c?.host) return; const k = `${c.host}:${c.port}`; if (seen.has(k)) return; seen.add(k); out.push({ host: c.host, port: c.port, secure: !!c.secure, reason, note: c.note ?? null }); };
  if (domain in KNOWN) { if (KNOWN[domain]) add(KNOWN[domain], 'nhà cung cấp quen'); else throw Object.assign(new Error(`${domain} không hỗ trợ IMAP trực tiếp (cần cầu nối riêng).`), { status: 400 }); }
  // MX: ai đang host mail cho tên miền này
  let mx = [];
  try { mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase()); } catch { /* không có MX */ }
  for (const ex of mx) for (const [re, cfg] of MX_HINTS) if (re.test(ex)) add(cfg, `MX ${ex}`);
  // SRV (RFC 6186)
  for (const [name, secure] of [[`_imaps._tcp.${domain}`, true], [`_imap._tcp.${domain}`, false]]) {
    try { const rr = (await dns.resolveSrv(name)).sort((a, b) => a.priority - b.priority); for (const r of rr) if (r.name && r.name !== '.') add({ host: r.name.replace(/\.$/, ''), port: r.port, secure }, 'DNS SRV'); } catch { /* không có SRV */ }
  }
  // Tên quen
  for (const h of [`imap.${domain}`, `mail.${domain}`, domain]) { add({ host: h, port: 993, secure: true }, 'tên quen'); add({ host: h, port: 143, secure: false }, 'tên quen, STARTTLS'); }
  return { domain, mx, candidates: out };
}

/** Thử mở cổng lần lượt (song song từng cụm 3) — trả về các ứng viên MỞ ĐƯỢC theo đúng thứ tự ưu tiên. */
export async function reachableCandidates(candidates, { timeout = 4000, max = 6 } = {}) {
  const ok = [];
  for (let i = 0; i < candidates.length && ok.length < max; i += 3) {
    const chunk = candidates.slice(i, i + 3);
    const res = await Promise.all(chunk.map((c) => probe(c.host, c.port, c.secure, timeout)));
    chunk.forEach((c, j) => { if (res[j]) ok.push(c); });
  }
  return ok;
}
