#!/bin/bash
# Chạy ứng dụng bằng Node (dành cho máy có Node.js 20+; người dùng phổ thông dùng bản .app thay vì file này).
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Máy này chưa cài Node.js 20 trở lên.\n\nHãy dùng bản ứng dụng Zalo Chat Assistant.app (không cần Node), hoặc cài Node từ https://nodejs.org" buttons {"OK"} with icon stop'
  exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
node scripts/ensure-native.js node
exec node src/index.js
