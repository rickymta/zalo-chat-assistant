# Không khai "# syntax=docker/dockerfile:1" (quy ước hạ tầng MedDental — tránh phụ thuộc Docker Hub lúc resolve).
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4789 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 4789
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4789/health || exit 1
CMD ["node", "src/index.js"]
