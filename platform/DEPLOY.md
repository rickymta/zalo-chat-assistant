# Triển khai nền tảng lên máy chủ — volcanion.vn

Mục tiêu: `https://volcanion.vn` là trang chính (tải ứng dụng, lịch sử phiên bản, bài viết, đăng nhập/đăng ký, **API cho ứng
dụng desktop**), `https://admin.volcanion.vn` là khu quản trị (bài viết, phiên bản, người dùng, nội dung trang chủ).
**Một lệnh `docker compose up -d` chạy cả máy chủ**: `mongo` + `api` + `web` + `edge` (Caddy nhận 80/443, tự xin và gia hạn
chứng chỉ Let's Encrypt, điều hướng theo tên miền). Máy chủ chỉ mở 80/443; api/web gắn loopback. Cơ sở dữ liệu là **MongoDB**
(container `mongo`, hoặc Mongo sẵn có qua `MONGO_URL`). Máy chủ xác thực cũ (`server/`, SQLite) **không triển khai**.
Không cần cài nginx/certbot trên máy chủ (nginx vẫn chạy *bên trong* ảnh web để phục vụ SPA và proxy `/api`).

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
sudo apt update && sudo apt install -y ca-certificates curl rsync
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"   # đăng nhập lại để nhóm docker có hiệu lực
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Máy chủ **không được** có nginx/apache nào khác đang giữ cổng 80/443 (`sudo ss -ltnp | grep -E ':80 |:443 '` phải trống) —
service `edge` cần hai cổng đó để nhận request và để Let's Encrypt kiểm chứng tên miền.

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
`openssl rand -base64 48`), `ADMIN_EMAILS`, `ACME_EMAIL` (email nhận cảnh báo chứng chỉ), `ALLOW_REGISTRATION`/`REGISTRATION_CODE`
theo ý muốn, SMTP nếu có. Các dòng đã điền sẵn và **phải giữ**: `COMPOSE_PROFILES=server` (bật service `edge`), `DOMAIN`,
`ADMIN_DOMAIN`, `PUBLIC_URL=https://volcanion.vn`, `CORS_ORIGINS`, `BIND_IP=127.0.0.1`. Dùng Mongo ngoài thì đổi `MONGO_URL`
và chạy `docker compose up -d api web edge` (không kéo service `mongo`).

## 4. Chạy — một lệnh

```bash
cd ~/zca-platform
docker compose up -d                    # lần đầu: dựng ảnh api + web tại chỗ (vài phút) rồi lên mongo → api → web → edge
docker compose ps                        # 4 container: zca-mongo, zca-api, zca-web (healthy), zca-edge
docker compose logs -f edge              # xem Caddy xin chứng chỉ: "certificate obtained successfully" cho 3 tên
```

Thứ tự khởi động do `depends_on` + healthcheck lo: web chờ api khoẻ, edge chờ web khoẻ. Ảnh `zca-platform-api`/`zca-platform-web`
không có trên registry nào — compose **dựng tại chỗ** (`pull_policy: build`), nên mọi lần sau vẫn chỉ `docker compose up -d`: mã không
đổi thì cache trúng hết trong vài giây, mã đổi (sau rsync) thì tự dựng lại. Máy khởi động lại thì Docker tự kéo cả bộ lên
(`restart: unless-stopped`).

## 5. HTTPS — tự động, không có bước riêng

Service `edge` (Caddy, cấu hình `deploy/caddy/Caddyfile`) xin chứng chỉ Let's Encrypt cho `DOMAIN`, `www.DOMAIN`,
`ADMIN_DOMAIN` ngay lần đầu lên và tự gia hạn; chứng chỉ nằm ở volume `caddy-data` (mất volume thì xin lại, không sao).
Điều hướng:

| Tên miền | Xử lý |
|---|---|
| `www.volcanion.vn` | 301 → `https://volcanion.vn/...` |
| `volcanion.vn` | → web; `/admin*` và `/api/admin/*` trả **404**; tệp tải lên tối đa 10 MB; HSTS |
| `admin.volcanion.vn` | `/` → 302 `/admin`; → web; tệp tải lên tối đa 600 MB (bộ cài); `X-Robots-Tag: noindex` |
| `http://…` | 308 → https |

Điều kiện để xin được chứng chỉ: DNS của cả 3 tên đã trỏ về máy **trước** khi `up`, cổng 80/443 tới được từ Internet. Chưa
trỏ DNS mà đã `up` thì Caddy chỉ báo lỗi và thử lại theo lịch (không chặn api/web); trỏ xong nó tự xin, không cần khởi động lại.
Thử trên máy dev: `.env` để `DOMAIN=localhost`, `ADMIN_DOMAIN=admin.localhost` ⇒ Caddy dùng chứng chỉ nội bộ tự ký, không gọi
Let's Encrypt (`curl -k --resolve admin.localhost:443:127.0.0.1 https://admin.localhost/`).

**Máy chủ đã có nginx riêng?** Bỏ `COMPOSE_PROFILES=server` (không chạy `edge`) và dùng hai file trong `deploy/nginx/`
(`volcanion.vn.conf` HTTP + ACME webroot, `volcanion.vn-ssl.conf` hai khối 443) với certbot của máy chủ — nội dung điều hướng
tương đương bảng trên; nginx trỏ về `127.0.0.1:4790`.

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
curl -sI http://volcanion.vn/ | head -1                     # 308 → https
ss -ltnp | grep -E '4789|4790'                              # phải là 127.0.0.1:… (không lộ ra ngoài)
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
# Cập nhật mã (sau rsync lại thư mục platform/): vẫn một lệnh — tự dựng lại ảnh có mã đổi
docker compose up -d
# Dừng / chạy lại cả bộ (giữ dữ liệu): docker compose down   |   docker compose up -d
# Sao lưu định kỳ (cron hằng ngày): mongodump + /data
docker exec zca-mongo mongodump --quiet --db zca --gzip --archive=/tmp/zca.dump && docker cp zca-mongo:/tmp/zca.dump ~/backup/zca-$(date +%F).dump
docker run --rm --volumes-from zca-api -v ~/backup:/out alpine:3 tar czf /out/data-$(date +%F).tgz -C /data .
# Nhật ký
docker compose logs -f --tail 200 api
sudo tail -f /var/log/nginx/access.log
```

- `docker compose up -d` **không** tự kéo/dựng ảnh mới nếu ảnh cùng tag đã có — luôn `build` (hoặc `pull`) trước `up`.
- Không mở 27017 ra ngoài; Mongo chỉ nói chuyện với api trong mạng Docker. Cần truy cập từ máy dev: `ssh -L 27017:…`.
- Chứng chỉ do Caddy tự gia hạn (kiểm tra: `docker compose logs edge | grep -i renew`). Đổi tên miền: sửa `DOMAIN`/`ADMIN_DOMAIN`
  trong `.env` rồi `docker compose up -d edge`.
- `docker compose down -v` XOÁ volume (Mongo + bộ cài + chứng chỉ) — không dùng trên máy chủ thật.
