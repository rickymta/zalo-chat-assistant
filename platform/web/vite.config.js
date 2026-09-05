import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cổng máy chủ mock (hoặc api thật) khi chạy dev. Đổi bằng biến môi trường ZCA_API_PORT.
const apiPort = process.env.ZCA_API_PORT || '4791';
const target = `http://127.0.0.1:${apiPort}`;

const proxy = {
  '/api': { target, changeOrigin: true },
  '/downloads': { target, changeOrigin: true },
  '/uploads': { target, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  // `vite preview` (xem thử bản build) cũng cần proxy — khai riêng vì Vite không dùng chung.
  preview: { port: 5174, strictPort: true, proxy },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
