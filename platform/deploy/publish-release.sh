#!/bin/bash
# Đẩy một bản phát hành (3 tệp cài trong dist/) lên máy chủ nền tảng qua API quản trị và Xuất bản.
# Dùng:  bash platform/deploy/publish-release.sh 0.0.2 https://volcanion.vn [ghi-chu.md]
# Đăng nhập bằng tài khoản admin của BẠN: đặt ZCA_ADMIN_EMAIL / ZCA_ADMIN_PASSWORD trong môi trường, hoặc script sẽ hỏi
# (mật khẩu nhập kín, không lưu đâu cả). Tệp tìm trong dist/ theo tên electron-builder tạo ra:
#   Zalo Chat Assistant-<v>-arm64.dmg · Zalo Chat Assistant-<v>-x64.dmg · Zalo Chat Assistant-Setup-<v>-x64.exe
set -euo pipefail
VER=${1:?Cần phiên bản, ví dụ 0.0.2}
API=${2:-https://volcanion.vn}; API=${API%/}
NOTES=${3:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIST="$ROOT/dist"
ARM="$DIST/Zalo Chat Assistant-$VER-arm64.dmg"
X64="$DIST/Zalo Chat Assistant-$VER-x64.dmg"
WIN="$DIST/Zalo Chat Assistant-Setup-$VER-x64.exe"
for f in "$ARM" "$X64" "$WIN"; do [ -f "$f" ] || { echo "Thiếu tệp: $f"; exit 1; }; done
[ -n "$NOTES" ] && [ ! -f "$NOTES" ] && { echo "Không thấy tệp ghi chú: $NOTES"; exit 1; }
EMAIL=${ZCA_ADMIN_EMAIL:-}; PASS=${ZCA_ADMIN_PASSWORD:-}
[ -n "$EMAIL" ] || read -r -p "Email admin trên $API: " EMAIL
[ -n "$PASS" ] || { read -r -s -p "Mật khẩu: " PASS; echo; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],r);console.log(v??(r.error?("LỖI: "+r.error):""))})' "$1"; }
TOK=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2],device:"publish-release"}))' "$EMAIL" "$PASS")" | json accessToken)
unset PASS
[[ "$TOK" == LỖI* || -z "$TOK" ]] && { echo "Đăng nhập thất bại: $TOK"; exit 1; }
up() { # $1 platform, $2 arch, $3 file
  local r; r=$(curl -s -X POST "$API/api/admin/releases" -H "Authorization: Bearer $TOK" \
    -F "version=$VER" -F channel=stable -F "platform=$1" -F "arch=$2" -F published=true \
    ${NOTES:+-F "notes=<$NOTES"} -F "file=@$3")
  echo "  $1/$2: $(echo "$r" | json release.version) $(echo "$r" | json release.sha256 | cut -c1-12) $(echo "$r" | json error)"
}
echo "Đẩy bản $VER lên $API …"
up darwin arm64 "$ARM"; up darwin x64 "$X64"; up win32 x64 "$WIN"
echo "Mới nhất theo máy chủ: $(curl -s "$API/api/releases/latest?platform=darwin&arch=arm64" | json release.version)"
