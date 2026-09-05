/**
 * Máy chủ xác thực Zalo Chat Assistant.
 * Nhiệm vụ: đăng ký / đăng nhập / quên mật khẩu / cấp–lưu–đổi chuỗi mã hoá client. KHÔNG lưu tin nhắn.
 */
import Fastify from 'fastify';
import { config } from './config.js';
import { openDb } from './db.js';
import { createMailer } from './mail.js';
import { registerRoutes } from './routes.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 64 * 1024 });
const log = app.log;
const db = openDb(config.dataDir);
const mailer = createMailer(config, log);

app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body || !String(body).trim()) return done(null, {});
  try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err, undefined); }
});

registerRoutes(app, { db, config, mailer, log });

app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Không tìm thấy.' }));
app.setErrorHandler((err, _req, reply) => {
  log.error(err);
  reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : 'Lỗi máy chủ.' });
});

await app.listen({ port: config.port, host: config.host });
log.info(`Máy chủ xác thực sẵn sàng — đăng ký ${config.allowRegistration ? (config.registrationCode ? 'cần mã' : 'mở') : 'ĐÓNG'}, SMTP ${mailer.configured ? 'có' : 'không (mã reset ghi ra log)'}`);

const shutdown = async () => { try { await app.close(); db.close(); } finally { process.exit(0); } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
