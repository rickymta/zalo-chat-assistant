/**
 * Tải tệp cài đặt: `GET /downloads/:id/:fileName` (và `HEAD` để trình tải kiểm dung lượng trước).
 *
 * Hai điều dễ sai đã chốt ở đây:
 *  - `fileName` trên URL phải TRÙNG tên đã lưu trong DB. Không bao giờ ghép thẳng tham số URL vào
 *    đường dẫn đĩa — đó là đường cho `../../etc/passwd`.
 *  - Chỉ `GET` mới tăng bộ đếm; `HEAD` thì không, nếu không mỗi lần trình duyệt dò dung lượng lại
 *    thổi phồng số lượt tải.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { Release } from '../models/Release.js';
import { DownloadEvent } from '../models/DownloadEvent.js';
import { wrap } from '../middleware/errors.js';

export const downloadsRouter = Router();

async function locate(req) {
  const release = await Release.findById(req.params.id).lean();
  if (!release || !release.fileName) return null;
  if (release.fileName !== req.params.fileName) return null;
  if (!release.publishedAt) return null;   // bản nháp không tải công khai được
  const filePath = path.join(config.releasesDir, release._id, release.fileName);
  if (!filePath.startsWith(path.resolve(config.releasesDir))) return null;
  if (!fs.existsSync(filePath)) return null;
  return { release, filePath };
}

function setHeaders(res, release, size) {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  // filename= chỉ nhận ASCII (trình duyệt hiển thị nguyên %20 nếu mã hoá URL vào đây); tên đầy đủ có Unicode đi qua filename*=.
  const ascii = release.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(release.fileName)}`);
  if (release.sha256) res.setHeader('X-Checksum-Sha256', release.sha256);
}

downloadsRouter.head('/:id/:fileName', wrap(async (req, res) => {
  const found = await locate(req);
  if (!found) return res.status(404).json({ error: 'Không tìm thấy tệp tải về.' });
  setHeaders(res, found.release, fs.statSync(found.filePath).size);
  res.status(200).end();
}));

downloadsRouter.get('/:id/:fileName', wrap(async (req, res) => {
  const found = await locate(req);
  if (!found) return res.status(404).json({ error: 'Không tìm thấy tệp tải về.' });

  const { release, filePath } = found;
  setHeaders(res, release, fs.statSync(filePath).size);

  await Release.updateOne({ _id: release._id }, { $inc: { downloads: 1 } });
  await DownloadEvent.create({ releaseId: release._id, at: Date.now() });

  fs.createReadStream(filePath).pipe(res);
}));
