#!/bin/bash
# Chép lại dữ liệu dịch vụ / bảng giá / bác sĩ từ repo mdt-re-construct-research (nguồn do marketing duy trì).
# Chạy lại mỗi khi bên đó cập nhật: bash scripts/sync-brand-docs.sh [đường-dẫn-repo]
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-$HOME/Meddental/work/meddental/mdt-re-construct-research}"
SRC="$REPO/docs/marketing-huong-dan-viet-bai/du-lieu"
[ -d "$SRC" ] || { echo "Không thấy $SRC"; exit 1; }
cp "$SRC/dich-vu.md" "$SRC/bang-gia-08-2023.md" "$SRC/bac-si.md" cowork/du-lieu/
echo "Đã cập nhật cowork/du-lieu/ từ $SRC"
