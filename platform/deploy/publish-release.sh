#!/bin/bash
# Đẩy một bản phát hành (3 tệp cài trong dist/) lên máy chủ nền tảng qua API quản trị và Xuất bản.
# Dùng:  bash platform/deploy/publish-release.sh 0.0.2 https://admin.volcanion.vn [ghi-chu.md]
# ⚠️ Phải gọi vào TÊN MIỀN QUẢN TRỊ (admin.<domain>): cổng vào chặn /api/admin/* ở tên miền chính (trả 404 trống).
# Đăng nhập bằng tài khoản admin của BẠN: đặt ZCA_ADMIN_EMAIL / ZCA_ADMIN_PASSWORD trong môi trường, hoặc script sẽ hỏi
# (mật khẩu nhập kín, không lưu đâu cả). Tệp tìm trong dist/ theo tên electron-builder tạo ra:
#   Zalo Chat Assistant-<v>-arm64.dmg · Zalo Chat Assistant-<v>-x64.dmg · Zalo Chat Assistant-Setup-<v>-x64.exe
set -euo pipefail
VER=${1:?Cần phiên bản, ví dụ 0.0.2}
API=${2:-https://admin.volcanion.vn}; API=${API%/}
# Lỡ đưa tên miền chính thì tự chuyển sang admin.<domain> (giữ nguyên nếu là localhost/IP).
if [[ "$API" =~ ^https?://(www\.)?([a-z0-9.-]+\.[a-z]{2,})$ ]] && [[ ! "$API" =~ ://admin\. ]]; then
  API="${API%%://*}://admin.${BASH_REMATCH[2]}"; echo "→ Dùng tên miền quản trị: $API"
fi
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
# Đọc một trường từ JSON; thân rỗng / không phải JSON thì báo thay vì vỡ.
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!s.trim()){console.log("(máy chủ trả rỗng)");return;}let r;try{r=JSON.parse(s)}catch{console.log("(không phải JSON: "+s.slice(0,80).replace(/\s+/g," ")+")");return;}const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],r);console.log(v??(r.error?("LỖI: "+r.error):""))})' "$1"; }
# curl trả thân + dòng cuối là mã HTTP.
call() { local out; out=$(curl -s -w $'\n%{http_code}' "$@"); HTTP=${out##*$'\n'}; BODY=${out%$'\n'*}; }
call -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2],device:"publish-release"}))' "$EMAIL" "$PASS")"
unset PASS
TOK=$(echo "$BODY" | json accessToken)
[[ "$TOK" == LỖI* || "$TOK" == \(* || -z "$TOK" ]] && { echo "Đăng nhập thất bại (HTTP $HTTP): $TOK"; exit 1; }
up() { # $1 platform, $2 arch, $3 file
  call -X POST "$API/api/admin/releases" -H "Authorization: Bearer $TOK" \
    -F "version=$VER" -F channel=stable -F "platform=$1" -F "arch=$2" -F published=true \
    ${NOTES:+-F "notes=<$NOTES"} -F "file=@$3"
  local v; v=$(echo "$BODY" | json release.version)
  if [[ "$v" == "$VER" ]]; then echo "  ✓ $1/$2: $VER  sha256 $(echo "$BODY" | json release.sha256 | cut -c1-12)…"
  else echo "  ✗ $1/$2: HTTP $HTTP — $(echo "$BODY" | json error)"; fi
}
echo "Đẩy bản $VER lên $API …"
up darwin arm64 "$ARM"; up darwin x64 "$X64"; up win32 x64 "$WIN"
echo "Mới nhất theo máy chủ: $(curl -s "$API/api/releases/latest?platform=darwin&arch=arm64" | json release.version)  (rỗng = chưa có bản nào được xuất bản)"
