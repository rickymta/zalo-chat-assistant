#!/bin/bash
# Gói dữ liệu nền tảng đang chạy trên MÁY NÀY (Docker: zca-mongo + volume zca-data) để chuyển lên máy chủ.
# Gồm: mongodump database zca (tài khoản, chuỗi mã hoá, phiên, phiên bản, bài viết) + /data (bộ cài, ảnh tải lên).
# Dùng: bash platform/deploy/export-data.sh [đường-dẫn-tệp-ra.tar.gz]
set -euo pipefail
OUT=${1:-"$HOME/zca-backups/platform-$(date +%Y%m%d-%H%M).tar.gz"}
mkdir -p "$(dirname "$OUT")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "→ mongodump zca"
docker exec zca-mongo mongodump --quiet --db zca --gzip --archive=/tmp/zca.dump
docker cp zca-mongo:/tmp/zca.dump "$TMP/zca.dump"
docker exec zca-mongo rm -f /tmp/zca.dump
echo "→ đóng gói /data (bộ cài + ảnh)"
docker run --rm --volumes-from zca-api -v "$TMP":/out alpine:3 tar czf /out/data.tgz -C /data .
tar czf "$OUT" -C "$TMP" zca.dump data.tgz
chmod 600 "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) — chép lên máy chủ: scp \"$OUT\" user@volcanion.vn:~/"
