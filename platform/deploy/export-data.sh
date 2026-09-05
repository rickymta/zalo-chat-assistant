#!/bin/bash
# Gói dữ liệu nền tảng đang chạy trên MÁY NÀY (Docker: zca-mongo + volume của zca-api) để chuyển lên máy chủ.
# Gồm: mọi collection của database zca (tài khoản, chuỗi mã hoá, phiên, bài viết, cấu hình trang) + CHỈ các bản phát hành
# ĐANG PUBLISHED (bản ghi + tệp cài) + ảnh tải lên. Bản nháp và tệp của chúng bị bỏ để gói nhẹ.
# Dùng: bash platform/deploy/export-data.sh [đường-dẫn-tệp-ra.tar.gz]      (cần mongo + api đang chạy: docker compose up -d mongo api)
set -euo pipefail
OUT=${1:-"$HOME/zca-backups/platform-$(date +%Y%m%d-%H%M).tar.gz"}
mkdir -p "$(dirname "$OUT")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
QUERY='{"publishedAt":{"$ne":null}}'
echo "→ mongodump zca (trừ releases)"
docker exec zca-mongo mongodump --quiet --db zca --excludeCollection releases --gzip --archive=/tmp/zca.dump
echo "→ mongodump releases đã phát hành"
docker exec zca-mongo mongodump --quiet --db zca --collection releases --query "$QUERY" --gzip --archive=/tmp/releases.dump
docker cp zca-mongo:/tmp/zca.dump "$TMP/zca.dump"; docker cp zca-mongo:/tmp/releases.dump "$TMP/releases.dump"
docker exec zca-mongo rm -f /tmp/zca.dump /tmp/releases.dump
IDS=$(docker exec zca-mongo mongosh --quiet zca --eval 'db.releases.find({publishedAt:{$ne:null}},{_id:1}).toArray().map(r=>"releases/"+r._id).join(" ")')
echo "→ đóng gói tệp cài của $(echo $IDS | wc -w | tr -d ' ') bản đã phát hành + uploads"
docker run --rm --volumes-from zca-api -v "$TMP":/out alpine:3 sh -c "cd /data && tar czf /out/data.tgz uploads $IDS 2>/dev/null || tar czf /out/data.tgz $IDS"
tar czf "$OUT" -C "$TMP" zca.dump releases.dump data.tgz
chmod 600 "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) — chép lên máy chủ: scp \"$OUT\" root@volcanion.vn:~/"
