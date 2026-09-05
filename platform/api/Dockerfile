# Không khai "# syntax=docker/dockerfile:1": directive đó bắt BuildKit hỏi Docker Hub trước MỖI lần build; Docker Hub tắc
# một nhịp là build hỏng ngay ở bước resolve. BuildKit tích hợp trong Docker Engine hiện tại đã đủ cho Dockerfile này.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Chỉ dependencies chạy thật — better-sqlite3 nằm ở devDependencies vì chỉ script migrate cần,
# và migrate chạy MỘT LẦN lúc cutover (từ máy quản trị), không phải trong ảnh production.
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4789 \
    RELEASES_DIR=/data/releases \
    UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/releases /data/uploads && chown -R node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 4789
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4789/health || exit 1
CMD ["node", "src/index.js"]
