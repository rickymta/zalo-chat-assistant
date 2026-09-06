/** Địa chỉ trang chính tương ứng: admin.<domain> → https://<domain>; máy dev → web ở cổng 4790. */
export function publicSiteUrl() {
  const { protocol, hostname } = window.location;
  if (/^admin\./i.test(hostname) && !/localhost$/i.test(hostname)) return `${protocol}//${hostname.replace(/^admin\./i, '')}`;
  return 'http://localhost:4790';
}
