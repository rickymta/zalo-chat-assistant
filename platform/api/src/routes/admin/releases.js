/**
 * Quản trị bản phát hành. Tệp cài đặt lưu ở `RELEASES_DIR/<id>/<fileName>` (id sinh TRƯỚC khi ghi tệp
 * để không phải di chuyển tệp 600 MB sau khi lưu DB).
 * sha256 tính bằng cách đọc lại tệp theo luồng — không nạp cả tệp vào RAM.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { Release } from '../../models/Release.js';
import { toPublicRelease, sortByVersionDesc } from '../../services/releases.js';
import { renderMarkdown } from '../../services/markdown.js';
import { isValidSemver } from '../../services/semver.js';
import { wrap } from '../../middleware/errors.js';

const PLATFORMS = ['darwin', 'win32', 'linux'];
const ARCHS = ['arm64', 'x64', 'universal'];
const CHANNELS = ['stable', 'beta'];

/** Chỉ giữ phần tên tệp, bỏ mọi thành phần đường dẫn — chặn `../` từ tên tệp do người dùng đặt. */
const safeName = (name) => path.basename(String(name ?? '')).replace(/[^\w.\- ()]+/g, '_').slice(0, 180) || 'app.bin';

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    req._releaseId = req._releaseId ?? crypto.randomUUID();
    const dir = path.join(config.releasesDir, req._releaseId);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(_req, file, cb) {
    cb(null, safeName(file.originalname));
  },
});

const upload = multer({ storage, limits: { fileSize: 600 * 1024 * 1024 } });

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const bool = (v, fallback = false) => (v === undefined || v === null || v === '' ? fallback : v === true || v === 'true' || v === '1');

export const adminReleasesRouter = Router();

adminReleasesRouter.get('/', wrap(async (_req, res) => {
  const rows = await Release.find({}).lean();
  res.json({ items: sortByVersionDesc(rows).map(toPublicRelease) });
}));

adminReleasesRouter.post('/', upload.single('file'), wrap(async (req, res) => {
  const b = req.body ?? {};
  const version = String(b.version ?? '').trim();
  const platform = String(b.platform ?? '').trim();
  const arch = String(b.arch ?? '').trim();
  const externalUrl = String(b.externalUrl ?? '').trim() || null;

  const fail = async (msg) => {
    if (req.file) await fs.promises.rm(path.dirname(req.file.path), { recursive: true, force: true });
    return res.status(400).json({ error: msg });
  };

  if (!isValidSemver(version)) return fail('Phiên bản phải theo dạng semver, ví dụ 1.2.0.');
  if (!PLATFORMS.includes(platform)) return fail(`Nền tảng phải là một trong: ${PLATFORMS.join(', ')}.`);
  if (!ARCHS.includes(arch)) return fail(`Kiến trúc phải là một trong: ${ARCHS.join(', ')}.`);
  if (!req.file && !externalUrl) return fail('Cần tải lên tệp cài đặt hoặc nhập externalUrl.');
  const channel = CHANNELS.includes(b.channel) ? b.channel : 'stable';
  if (b.minVersion && !isValidSemver(b.minVersion)) return fail('minVersion phải theo dạng semver.');

  const id = req._releaseId ?? crypto.randomUUID();
  const notes = String(b.notes ?? '');

  const doc = await Release.create({
    _id: id,
    version,
    channel,
    platform,
    arch,
    fileName: req.file ? req.file.filename : (b.fileName ? safeName(b.fileName) : null),
    fileSize: req.file ? req.file.size : Number(b.fileSize ?? 0) || 0,
    sha256: req.file ? await sha256File(req.file.path) : null,
    externalUrl,
    notes,
    notesHtml: renderMarkdown(notes),
    mandatory: bool(b.mandatory),
    minVersion: String(b.minVersion ?? '').trim() || null,
    publishedAt: bool(b.published) ? Date.now() : null,
    downloads: 0,
    createdAt: Date.now(),
    createdBy: req.user._id,
  });

  console.log(`[releases] Tạo bản ${doc.version} (${doc.platform}/${doc.arch}) — ${doc.fileName ?? doc.externalUrl}`);
  res.json({ release: toPublicRelease(doc) });
}));

adminReleasesRouter.put('/:id', wrap(async (req, res) => {
  const doc = await Release.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy bản phát hành.' });
  const b = req.body ?? {};

  if (b.notes !== undefined) { doc.notes = String(b.notes); doc.notesHtml = renderMarkdown(doc.notes); }
  if (b.mandatory !== undefined) doc.mandatory = bool(b.mandatory);
  if (b.minVersion !== undefined) {
    const mv = String(b.minVersion ?? '').trim();
    if (mv && !isValidSemver(mv)) return res.status(400).json({ error: 'minVersion phải theo dạng semver.' });
    doc.minVersion = mv || null;
  }
  if (b.channel !== undefined) {
    if (!CHANNELS.includes(b.channel)) return res.status(400).json({ error: `Kênh phải là một trong: ${CHANNELS.join(', ')}.` });
    doc.channel = b.channel;
  }
  if (b.externalUrl !== undefined) doc.externalUrl = String(b.externalUrl ?? '').trim() || null;
  if (b.version !== undefined) {
    if (!isValidSemver(b.version)) return res.status(400).json({ error: 'Phiên bản phải theo dạng semver.' });
    doc.version = String(b.version).trim();
  }

  await doc.save();
  res.json({ release: toPublicRelease(doc) });
}));

adminReleasesRouter.post('/:id/publish', wrap(async (req, res) => {
  const doc = await Release.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy bản phát hành.' });
  const published = bool(req.body?.published, true);
  if (published && !doc.fileName && !doc.externalUrl) {
    return res.status(400).json({ error: 'Bản này chưa có tệp cài đặt hoặc externalUrl, không phát hành được.' });
  }
  doc.publishedAt = published ? (doc.publishedAt ?? Date.now()) : null;
  await doc.save();
  console.log(`[releases] ${published ? 'Phát hành' : 'Gỡ'} bản ${doc.version} (${doc.platform}/${doc.arch})`);
  res.json({ release: toPublicRelease(doc) });
}));

adminReleasesRouter.delete('/:id', wrap(async (req, res) => {
  const doc = await Release.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy bản phát hành.' });
  await fs.promises.rm(path.join(config.releasesDir, doc._id), { recursive: true, force: true });
  await doc.deleteOne();
  res.json({ ok: true });
}));
