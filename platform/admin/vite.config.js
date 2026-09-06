import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy /api, /uploads, /downloads sang api thật (docker compose up -d api → 127.0.0.1:4789). Đổi bằng ZCA_API_PORT.
const apiPort = process.env.ZCA_API_PORT || '4789';
const target = `http://127.0.0.1:${apiPort}`;
const proxy = {
  '/api': { target, changeOrigin: true },
  '/downloads': { target, changeOrigin: true },
  '/uploads': { target, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true, proxy },
  preview: { port: 5175, strictPort: true, proxy },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
