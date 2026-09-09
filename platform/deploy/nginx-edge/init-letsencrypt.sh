#!/bin/bash
# Bootstrap chứng chỉ Let's Encrypt cho nginx edge — CHẠY MỘT LẦN trước lần `docker compose up -d` đầu tiên
# (hoặc khi chuyển từ Caddy sang nginx). Sau đó nginx tự chạy, certbot tự gia hạn.
#
# Điều kiện: DNS của DOMAIN, www.DOMAIN, ADMIN_DOMAIN đã trỏ về máy này; cổng 80/443 mở; đã có .env với
# DOMAIN / ADMIN_DOMAIN / ACME_EMAIL.  Chạy tại thư mục platform/:  bash deploy/nginx-edge/init-letsencrypt.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> platform/
[ -f .env ] && set -a && . ./.env && set +a
DOMAIN="${DOMAIN:?Cần DOMAIN trong .env}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.$DOMAIN}"
EMAIL="${ACME_EMAIL:-admin@$DOMAIN}"
DC="docker compose"
# Service certbot có entrypoint là vòng lặp renew → lệnh certbot một lần phải ghi đè --entrypoint certbot.

echo "→ Domain: $DOMAIN, $ADMIN_DOMAIN  · email: $EMAIL"

# 1) Chứng chỉ TẠM (self-signed) để nginx khởi động được (nginx không chạy nếu thiếu cert).
echo "→ Tạo chứng chỉ tạm để nginx boot…"
$DC run --rm --entrypoint "sh -c '\
  mkdir -p /etc/letsencrypt/live/$DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out    /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj /CN=$DOMAIN'" certbot

# 1b) Tên miền mail (mail.conf.template cần cert riêng /live/$MAIL_DOMAIN). Chưa có thì tạo tạm để nginx boot;
#     cert thật xin sau bằng: bash deploy/nginx-edge/issue-mail-cert.sh
MAIL_DOMAIN="${MAIL_DOMAIN:-mail.$DOMAIN}"
$DC run --rm --entrypoint "sh -c '\
  [ -f /etc/letsencrypt/live/$MAIL_DOMAIN/fullchain.pem ] && exit 0; \
  mkdir -p /etc/letsencrypt/live/$MAIL_DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$MAIL_DOMAIN/privkey.pem \
    -out    /etc/letsencrypt/live/$MAIL_DOMAIN/fullchain.pem \
    -subj /CN=$MAIL_DOMAIN'" certbot

# 2) Bật nginx (đọc cert tạm).
echo "→ Khởi động web, admin, api, edge…"
$DC up -d api web admin edge
sleep 5

# 3) Với domain thật: xin cert Let's Encrypt (một cert phủ cả 3 tên) qua webroot, thay cert tạm.
if [ "$DOMAIN" = "localhost" ]; then
  echo "→ DOMAIN=localhost: giữ chứng chỉ tự ký (không gọi Let's Encrypt)."
else
  echo "→ Xoá cert tạm rồi xin Let's Encrypt…"
  $DC run --rm --entrypoint "sh -c 'rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf'" certbot || true
  $DC run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --keep-until-expiring \
    -d "$DOMAIN" -d "www.$DOMAIN" -d "$ADMIN_DOMAIN"
  echo "→ Nạp lại nginx với cert thật…"
  $DC exec edge nginx -s reload
fi
echo "✓ Xong. Từ nay chỉ cần: docker compose up -d"
