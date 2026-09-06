/** Địa chỉ ứng dụng quản trị (app riêng): <domain> → https://admin.<domain>; máy dev → cổng 4792. */
export function adminSiteUrl() {
  const { protocol, hostname } = window.location;
  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return 'http://localhost:4792';
  return `${protocol}//admin.${hostname.replace(/^www\./i, '')}`;
}
