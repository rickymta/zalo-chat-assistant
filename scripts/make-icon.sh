#!/bin/bash
# Tạo build/icon.icns từ một SVG đơn giản — chỉ dùng công cụ có sẵn trên macOS (qlmanage, sips, iconutil).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
cat > build/icon.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0068ff"/><stop offset="1" stop-color="#00b4ff"/></linearGradient></defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
  <path d="M300 300h424v72L392 660h340v64H292v-72l332-288H300z" fill="#fff"/>
  <circle cx="760" cy="760" r="96" fill="#16a34a" stroke="#fff" stroke-width="28"/>
</svg>
SVG
rm -rf build/icon.iconset build/icon.svg.png
qlmanage -t -s 1024 -o build build/icon.svg >/dev/null 2>&1 || true
if [ ! -f build/icon.svg.png ]; then echo "Không render được SVG bằng qlmanage — bỏ qua icon (dùng icon mặc định)."; exit 0; fi
mkdir -p build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.svg.png --out build/icon.iconset/icon_${s}x${s}.png >/dev/null
  d=$((s*2)); sips -z $d $d build/icon.svg.png --out build/icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns
cp build/icon.svg.png build/icon.png
rm -rf build/icon.iconset build/icon.svg.png
echo "Đã tạo build/icon.icns"
