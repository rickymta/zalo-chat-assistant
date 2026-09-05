# Triển khai nền tảng lên máy chủ — volcanion.vn

Mục tiêu: `https://volcanion.vn` là trang chính (tải ứng dụng, lịch sử phiên bản, bài viết, đăng nhập/đăng ký, **API cho ứng
dụng desktop**), `https://admin.volcanion.vn` là khu quản trị (bài viết, phiên bản, người dùng, nội dung trang chủ). nginx
của máy chủ nhận mọi request ở 80/443 và chuyển vào container web (127.0.0.1:4790); các cổng khác không mở ra ngoài.
Cơ sở dữ liệu là **MongoDB** (container `mongo` trong compose, hoặc Mongo sẵn có qua `MONGO_URL`). Máy chủ xác thực cũ
(`server/`, SQLite) **không triển khai**.

## 0. Không cần tên miền riêng cho API hay cập nhật

| Việc | Địa chỉ | Ai gọi |
|---|---|---|
| Trang web, tải ứng dụng, lịch sử phiên bản | `https://volcanion.vn/`, `/tai-ve`, `/cap-nhat` | Người dùng |
| API tài khoản, chuỗi mã hoá, kiểm tra cập nhật | `https://volcanion.vn/api/auth/…`, `/api/keys`, `/api/releases/check` | Ứng dụng desktop |
| Tệp cài `.dmg`/`.exe` | `https://volcanion.vn/downloads/<id>/<tên tệp>` | Trình duyệt, do ứng dụng mở khi có bản mới |
| Khu quản trị | `https://admin.volcanion.vn/` → `/admin` | Tài khoản `role: admin` |

Ứng dụng desktop chỉ cần **một** địa chỉ máy chủ (mặc định `https://volcanion.vn` từ bản 0.0.2; đổi được ở màn đăng nhập →
*Nâng cao*). Cập nhật dùng cùng máy chủ đó, trừ khi người dùng đặt riêng `updateServerUrl` trong Cài đặt. Tách `api.` hay
`dl.` chỉ có ích khi sau này muốn đưa tệp cài lên CDN/object storage — lúc đó điền `externalUrl` cho từng bản trong CMS là đủ,
không phải đổi ứng dụng.

DNS cần 3 bản ghi A (hoặc AAAA) trỏ về máy chủ: `volcanion.vn`, `www.volcanion.vn`, `admin.volcanion.vn`.

## 1. Chuẩn bị máy chủ (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt install -y ca-certificates curl nginx certbot rsync
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"   # đăng nhập lại để nhóm docker có hiệu lực
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
sudo mkdir -p /var/www/certbot
```

Docker bind cổng qua iptables nên **có thể vượt qua ufw** — vì thế compose gắn api/web vào `127.0.0.1` (`BIND_IP`), không
phải mở rồi chặn. Kiểm tra sau khi chạy: `ss -ltnp | grep -E '4789|4790'` phải thấy `127.0.0.1:` chứ không phải `0.0.0.0:`.

## 2. Chép mã nguồn

Kho này chỉ commit cục bộ, không có remote, nên chép thư mục `platform/` bằng rsync (bỏ `.env` và `node_modules`):

```bash
rsync -az --delete --exclude .env --exclude node_modules --exclude dist \
  ~/Meddental/work/meddental/zalo-chat-assistant/platform/  user@volcanion.vn:~/zca-platform/
```

## 3. Biến môi trường

```bash
ssh user@volcanion.vn
cd ~/zca-platform && cp .env.production.example .env && chmod 600 .env && nano .env
```

Điền: `JWT_SECRET` (**giữ nguyên giá trị đang dùng ở máy hiện tại** nếu chuyển dữ liệu — xem mục 6; máy mới hoàn toàn thì
`openssl rand -base64 48`), `ADMIN_EMAILS`, `PUBLIC_URL=https://volcanion.vn`, `CORS_ORIGINS` (đã điền sẵn ba tên miền),
`ALLOW_REGISTRATION`/`REGISTRATION_CODE` theo ý muốn, SMTP nếu có. Dùng Mongo ngoài thì đổi `MONGO_URL` và về sau chạy
`docker compose up -d api web` (không kéo service `mongo`).

## 4. Chạy nền tảng

```bash
cd ~/zca-platform
docker compose up -d --build            # mongo + api + web; lần đầu build mất vài phút
docker compose ps
curl -s http://127.0.0.1:4789/health    # {"status":"ok",...}
curl -sI http://127.0.0.1:4790/ | head -1
```

## 5. nginx + HTTPS (Let's Encrypt, gia hạn tự động theo webroot)

```bash
sudo cp deploy/nginx/volcanion.vn.conf     /etc/nginx/sites-available/volcanion.vn
sudo cp deploy/nginx/volcanion.vn-ssl.conf /etc/nginx/sites-available/volcanion.vn-ssl
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/volcanion.vn /etc/nginx/sites-enabled/volcanion.vn
sudo nginx -t && sudo systemctl reload nginx                       # lúc này chỉ có HTTP + ACME

sudo certbot certonly --webroot -w /var/www/certbot \
  -d volcanion.vn -d www.volcanion.vn -d admin.volcanion.vn \
  --email quandh@meddental.vn --agree-tos --no-eff-email \
  --deploy-hook "systemctl reload nginx"

sudo ln -sf /etc/nginx/sites-available/volcanion.vn-ssl /etc/nginx/sites-enabled/volcanion.vn-ssl
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                                       # xác nhận gia hạn tự động chạy được
```

Nếu `nginx -t` báo thiếu `/etc/letsencrypt/options-ssl-nginx.conf` hoặc `ssl-dhparams.pem` (bản certbot cũ không tạo kèm):
`sudo apt install -y python3-certbot-nginx` rồi `nginx -t` lại, hoặc xoá hai dòng đó trong file `-ssl.conf`.

## 6. Chuyển dữ liệu từ máy hiện tại (tài khoản, chuỗi mã hoá, bộ cài)

**Bắt buộc** nếu muốn người đang dùng (anv@, quandh@ …) đăng nhập được trên máy chủ mới mà **không mất dữ liệu đã mã hoá**:
chuỗi mã hoá gắn với `id` người dùng trong Mongo; tạo lại tài khoản trên máy chủ trống sẽ ra `id` khác, ứng dụng báo xung
đột chủ sở hữu và chỉ có thể xoá dữ liệu cục bộ để dùng tiếp.

Trên máy hiện tại (Docker `zca-mongo` + `zca-api` đang chạy):

```bash
bash platform/deploy/export-data.sh                      # → ~/zca-backups/platform-YYYYMMDD-HHMM.tar.gz (quyền 600)
scp ~/zca-backups/platform-*.tar.gz user@volcanion.vn:~/
```

Trên máy chủ (sau mục 4, **ghi đè** database `zca` và `/data`):

```bash
cd ~/zca-platform && bash deploy/import-data.sh ~/platform-YYYYMMDD-HHMM.tar.gz
```

`downloadUrl` của các bản đã phát hành được dựng lại từ `PUBLIC_URL` mỗi lần trả API nên tự thành `https://volcanion.vn/…`.
Hai bản `0.0.1` (ba nền tảng) và `0.0.1-beta.1` đang published; 24 bản `1.1.x` là bản nháp — xoá ở admin → Phiên bản khi tiện.

## 7. Kiểm tra sau triển khai

```bash
curl -s https://volcanion.vn/health
curl -s "https://volcanion.vn/api/releases/latest?platform=darwin&arch=arm64" | head -c 300
curl -sI https://volcanion.vn/admin | head -1              # 404 — khu quản trị không phục vụ ở tên miền chính
curl -sI https://admin.volcanion.vn/ | head -3              # 302 → /admin
```

Mở `https://volcanion.vn/tai-ve` trên máy Mac và máy Windows để xem trang tự nhận diện nền tảng; đăng nhập
`https://admin.volcanion.vn` bằng email trong `ADMIN_EMAILS`.

## 8. Ứng dụng desktop

- Từ bản **0.0.2**, máy chủ mặc định là `https://volcanion.vn` (mã: `src/config.js` `DEFAULT_SERVER_URL`). Bản 0.0.1 đang phát
  hành vẫn mặc định `http://127.0.0.1:4789` → sau khi máy chủ chạy, dựng và phát hành 0.0.2 (tăng `version` trong
  `package.json`, `npm run dist`, `dist:x64`, `dist:win`, tải lên admin → Phiên bản → Xuất bản).
- Máy đã cài và đã đăng nhập giữ địa chỉ máy chủ cũ trong `data/auth.json`. Cách chuyển: Cài đặt → Đăng xuất (không xoá dữ
  liệu vì cùng tài khoản/cùng chuỗi mã hoá đã chuyển theo mục 6) → màn đăng nhập → *Nâng cao* → nhập `https://volcanion.vn`
  → đăng nhập lại. Cài đặt → *Máy chủ cập nhật* để trống thì theo máy chủ tài khoản.
- Dựng bản với mặc định khác: `ZCA_SERVER_URL=https://… npm run dist`.

## 9. Vận hành

```bash
# Cập nhật mã (sau rsync lại thư mục platform/):
docker compose build api web && docker compose up -d api web
# Sao lưu định kỳ (cron hằng ngày): mongodump + /data
docker exec zca-mongo mongodump --quiet --db zca --gzip --archive=/tmp/zca.dump && docker cp zca-mongo:/tmp/zca.dump ~/backup/zca-$(date +%F).dump
docker run --rm --volumes-from zca-api -v ~/backup:/out alpine:3 tar czf /out/data-$(date +%F).tgz -C /data .
# Nhật ký
docker compose logs -f --tail 200 api
sudo tail -f /var/log/nginx/access.log
```

- `docker compose up -d` **không** tự kéo/dựng ảnh mới nếu ảnh cùng tag đã có — luôn `build` (hoặc `pull`) trước `up`.
- Không mở 27017 ra ngoài; Mongo chỉ nói chuyện với api trong mạng Docker. Cần truy cập từ máy dev: `ssh -L 27017:…`.
- Chứng chỉ gia hạn tự động bởi timer của certbot (`systemctl list-timers | grep certbot`), deploy-hook đã reload nginx.
