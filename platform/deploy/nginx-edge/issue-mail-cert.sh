#!/bin/bash
# Xin chứng chỉ Let's Encrypt RIÊNG cho tên miền mail (MAIL_DOMAIN, mặc định mail.<DOMAIN>) — dùng cho webmail qua
# edge (mail.conf.template) và cho mailserver ở /opt/mail (đọc chung volume letsencrypt).
# Điều kiện: edge đang chạy với mail.conf.template (khối cổng 80 trả lời ACME) và DNS A của MAIL_DOMAIN đã trỏ về
# máy này (KHÔNG bật proxy Cloudflare). Chạy tại platform/:   bash deploy/nginx-edge/issue-mail-cert.sh
# Chạy lại an toàn: cert còn hạn thì certbot bỏ qua. Gia hạn về sau do service certbot lo (cùng webroot).
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> platform/
[ -f .env ] && set -a && . ./.env && set +a
DOMAIN="${DOMAIN:?Cần DOMAIN trong .env}"
MAIL_DOMAIN="${MAIL_DOMAIN:-mail.$DOMAIN}"
EMAIL="${ACME_EMAIL:-admin@$DOMAIN}"
DC="docker compose"
# Service certbot có entrypoint là vòng lặp renew → phải ghi đè entrypoint mới chạy được lệnh certbot một lần.
CERTBOT="$DC run --rm --entrypoint certbot certbot"

echo "→ Mail domain: $MAIL_DOMAIN · email: $EMAIL"

# Cert tạm (self-signed do init-letsencrypt.sh tạo, không có renewal conf) → xoá để certbot không sinh lineage -0001.
$DC run --rm --entrypoint "sh -c '\
  [ -f /etc/letsencrypt/renewal/$MAIL_DOMAIN.conf ] || rm -rf /etc/letsencrypt/live/$MAIL_DOMAIN'" certbot || true

$CERTBOT certonly --webroot -w /var/www/certbot \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --keep-until-expiring \
  -d "$MAIL_DOMAIN"

echo "→ Nạp lại nginx…"
$DC exec edge nginx -s reload
echo "✓ Xong: /etc/letsencrypt/live/$MAIL_DOMAIN/ trong volume letsencrypt. Mailserver (/opt/mail) tự nhận khi khởi động."
