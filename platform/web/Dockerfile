# ── Tầng 1: dựng bản tĩnh ─────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifest trước để tầng cài phụ thuộc được cache lại khi chỉ sửa mã nguồn.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
RUN npm run build

# ── Tầng 2: phục vụ bằng nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
