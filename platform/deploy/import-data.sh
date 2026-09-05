#!/bin/bash
# Khôi phục gói do export-data.sh tạo vào nền tảng TRÊN MÁY CHỦ (chạy trong thư mục platform/, sau docker compose up -d).
# GHI ĐÈ database zca và /data hiện có — chỉ dùng khi máy chủ còn trống hoặc cố ý thay toàn bộ.
# Dùng: bash deploy/import-data.sh ~/platform-YYYYMMDD-HHMM.tar.gz
set -euo pipefail
ARCHIVE=${1:?Cần đường dẫn tệp .tar.gz do export-data.sh tạo}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar xzf "$ARCHIVE" -C "$TMP"
echo "→ mongorestore zca (--drop)"
docker cp "$TMP/zca.dump" zca-mongo:/tmp/zca.dump
docker exec zca-mongo mongorestore --quiet --gzip --archive=/tmp/zca.dump --drop --nsInclude='zca.*'
docker exec zca-mongo rm -f /tmp/zca.dump
echo "→ /data (bộ cài + ảnh)"
docker run --rm --volumes-from zca-api -v "$TMP":/in alpine:3 sh -c 'tar xzf /in/data.tgz -C /data'
docker compose restart api >/dev/null
echo "✓ Xong. Kiểm tra: curl -s https://volcanion.vn/api/releases/latest?platform=darwin\&arch=arm64"
