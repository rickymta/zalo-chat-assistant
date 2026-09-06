/** Dựng ứng dụng Express (tách khỏi index.js để kiểm thử dựng app mà không mở cổng). */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { requestLogger } from './middleware/logger.js';
import { notFound, errorHandler, wrap } from './middleware/errors.js';
import { mailer } from './services/mailer.js';
import { User } from './models/User.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { keysRouter } from './routes/keys.js';
import { releasesRouter } from './routes/releases.js';
import { downloadsRouter } from './routes/downloads.js';
import { postsRouter } from './routes/posts.js';
import { siteRouter } from './routes/site.js';
import { adminRouter } from './routes/admin/index.js';

export function createApp() {
  const app = express();

  // Đứng sau nginx: cần trust proxy để `req.ip` là IP thật, nếu không giới hạn tần suất tính chung một IP.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(helmet({
    // Tệp tải về và ảnh phải nhúng được từ trang web ở cổng khác.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));

  app.use(cors({
    origin(origin, cb) {
      // Không có Origin = gọi từ ứng dụng desktop / curl / server-side ⇒ cho qua.
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
      // 403 thay vì 500: đây là lỗi cấu hình (thiếu origin trong CORS_ORIGINS), không phải lỗi máy chủ.
      cb(Object.assign(new Error(`Nguồn ${origin} không nằm trong CORS_ORIGINS.`), { status: 403 }));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestLogger());

  app.get('/health', wrap(async (_req, res) => {
    res.json({ status: 'ok', users: await User.countDocuments({}), smtp: mailer.configured, version: config.version });
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/keys', keysRouter);
  app.use('/api/releases', releasesRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/site', siteRouter);
  app.use('/api/admin', adminRouter);
  app.use('/downloads', downloadsRouter);

  // Ảnh CMS phục vụ tĩnh; `index: false` để không lộ danh sách thư mục.
  app.use('/uploads', express.static(config.uploadsDir, { index: false, maxAge: '7d', fallthrough: true }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
