#!/bin/bash
# Đẩy một bản phát hành (3 tệp cài trong dist/) lên máy chủ nền tảng qua API quản trị và Xuất bản.
# Dùng:  bash platform/deploy/publish-release.sh <phiên-bản> [https://admin.volcanion.vn] [ghi-chu.md] [all|win32|darwin|darwin-arm64|darwin-x64]
#   ví dụ chỉ đẩy bản Windows:  bash platform/deploy/publish-release.sh 0.0.3 https://admin.volcanion.vn ~/Desktop/ghi-chu-0.0.3.md win32
# ⚠️ Phải gọi vào TÊN MIỀN QUẢN TRỊ (admin.<domain>): cổng vào chặn /api/admin/* ở tên miền chính (trả 404 trống).
# Cùng phiên bản + nền tảng đã có trên máy chủ ⇒ bản cũ bị XOÁ rồi thay bằng tệp mới (không tạo bản trùng).
# Đăng nhập bằng tài khoản admin của BẠN: đặt ZCA_ADMIN_EMAIL / ZCA_ADMIN_PASSWORD trong môi trường, hoặc script sẽ hỏi
# (mật khẩu nhập kín, không lưu đâu cả). Tệp tìm trong dist/ theo tên electron-builder tạo ra:
#   <productName>-<v>-arm64.dmg · <productName>-<v>-x64.dmg · <productName>-Setup-<v>-x64.exe (tên lấy từ package.json)
set -euo pipefail
VER=${1:?Cần phiên bản, ví dụ 0.0.2}
API=${2:-https://admin.volcanion.vn}; API=${API%/}
# Lỡ đưa tên miền chính thì tự chuyển sang admin.<domain> (giữ nguyên nếu là localhost/IP hoặc đã là admin.).
HOST=${API#*://}; HOST=${HOST%%/*}; HOST=${HOST#www.}
if [[ "$HOST" != admin.* && "$HOST" != localhost* && "$HOST" != 127.* && "$HOST" == *.* && ! "$HOST" =~ ^[0-9.:]+$ ]]; then
  API="${API%%://*}://admin.$HOST"; echo "→ Dùng tên miền quản trị: $API"
fi
NOTES=${3:-}
ONLY=${4:-all}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIST="$ROOT/dist"
# Tên sản phẩm lấy từ package.json (đổi tên app là script tự theo).
PROD=$(node -e 'console.log(require("'"$ROOT"'/package.json").productName)')
ARM="$DIST/$PROD-$VER-arm64.dmg"
X64="$DIST/$PROD-$VER-x64.dmg"
WIN="$DIST/$PROD-Setup-$VER-x64.exe"
want() { case "$ONLY" in all) return 0;; win32) [[ "$1" == win32 ]];; darwin) [[ "$1" == darwin ]];; darwin-arm64) [[ "$1/$2" == darwin/arm64 ]];; darwin-x64) [[ "$1/$2" == darwin/x64 ]];; *) echo "Bộ lọc không hợp lệ: $ONLY"; exit 1;; esac; }
want darwin arm64 && { [ -f "$ARM" ] || { echo "Thiếu tệp: $ARM"; exit 1; }; }
want darwin x64   && { [ -f "$X64" ] || { echo "Thiếu tệp: $X64"; exit 1; }; }
want win32 x64    && { [ -f "$WIN" ] || { echo "Thiếu tệp: $WIN"; exit 1; }; }
[ -n "$NOTES" ] && [ ! -f "$NOTES" ] && { echo "Không thấy tệp ghi chú: $NOTES"; exit 1; }
EMAIL=${ZCA_ADMIN_EMAIL:-}; PASS=${ZCA_ADMIN_PASSWORD:-}
[ -n "$EMAIL" ] || read -r -p "Email admin trên $API: " EMAIL
[ -n "$PASS" ] || { read -r -s -p "Mật khẩu: " PASS; echo; }
# Đọc một trường từ JSON; thân rỗng / không phải JSON thì báo thay vì vỡ.
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!s.trim()){console.log("(máy chủ trả rỗng)");return;}let r;try{r=JSON.parse(s)}catch{console.log("(không phải JSON: "+s.slice(0,80).replace(/\s+/g," ")+")");return;}const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],r);console.log(v??(r.error?("LỖI: "+r.error):""))})' "$1"; }
# curl trả thân + dòng cuối là mã HTTP.
call() { local out; out=$(curl -s -w $'\n%{http_code}' "$@"); HTTP=${out##*$'\n'}; BODY=${out%$'\n'*}; }
call -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2],device:"publish-release"}))' "$EMAIL" "$PASS")"
unset PASS
TOK=$(echo "$BODY" | json accessToken)
[[ "$TOK" == LỖI* || "$TOK" == \(* || -z "$TOK" ]] && { echo "Đăng nhập thất bại (HTTP $HTTP): $TOK"; exit 1; }
# Xoá bản cùng phiên bản + nền tảng đã có (thay tệp), để không sinh bản trùng trên trang Cập nhật.
replace_old() { # $1 platform, $2 arch
  call -H "Authorization: Bearer $TOK" "$API/api/admin/releases"
  for id in $(echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);(r.items||r).filter(x=>x.version===process.argv[1]&&x.platform===process.argv[2]&&x.arch===process.argv[3]).forEach(x=>console.log(x.id))}catch{}})' "$VER" "$1" "$2"); do
    echo "  ↺ $1/$2: đã có bản $VER trên máy chủ — xoá để thay tệp mới"
    curl -s -o /dev/null -X DELETE "$API/api/admin/releases/$id" -H "Authorization: Bearer $TOK"
  done
}
up() { # $1 platform, $2 arch, $3 file
  want "$1" "$2" || return 0
  replace_old "$1" "$2"
  call -X POST "$API/api/admin/releases" -H "Authorization: Bearer $TOK" \
    -F "version=$VER" -F channel=stable -F "platform=$1" -F "arch=$2" -F published=true \
    ${NOTES:+-F "notes=<$NOTES"} -F "file=@$3"
  local v; v=$(echo "$BODY" | json release.version)
  if [[ "$v" == "$VER" ]]; then echo "  ✓ $1/$2: $VER  sha256 $(echo "$BODY" | json release.sha256 | cut -c1-12)…"
  else echo "  ✗ $1/$2: HTTP $HTTP — $(echo "$BODY" | json error)"; fi
}
echo "Đẩy bản $VER lên $API …"
up darwin arm64 "$ARM"; up darwin x64 "$X64"; up win32 x64 "$WIN"
for p in "darwin&arch=arm64" "darwin&arch=x64" "win32&arch=x64"; do echo "Mới nhất theo máy chủ ($p): $(curl -s "$API/api/releases/latest?platform=$p" | json release.version)"; done
