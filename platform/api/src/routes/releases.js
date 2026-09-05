/** Bản phát hành công khai + kiểm tra cập nhật cho ứng dụng desktop (mục 3 hợp đồng). */
import { Router } from 'express';
import { Release } from '../models/Release.js';
import { toPublicRelease, sortByVersionDesc, findLatest } from '../services/releases.js';
import { cmpSemver } from '../services/semver.js';
import { wrap } from '../middleware/errors.js';

export const releasesRouter = Router();

/** Danh sách bản ĐÃ PUBLISH, mới nhất trước (so semver, không so ngày). */
releasesRouter.get('/', wrap(async (req, res) => {
  const { platform, arch, channel = 'stable' } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

  const filter = { publishedAt: { $ne: null } };
  if (channel) filter.channel = channel;
  if (platform) filter.platform = platform;
  if (arch) filter.arch = arch;

  const rows = await Release.find(filter).lean();
  res.json({ items: sortByVersionDesc(rows).slice(0, limit).map(toPublicRelease) });
}));

releasesRouter.get('/latest', wrap(async (req, res) => {
  const { platform, arch, channel = 'stable' } = req.query;
  const row = await findLatest({ platform, arch, channel });
  res.json({ release: toPublicRelease(row) });
}));

/**
 * Ứng dụng gọi lúc khởi động và mỗi 6 giờ.
 * `mandatory` = bản mới tự đánh dấu bắt buộc, HOẶC bản đang chạy cũ hơn `minVersion` của bản mới.
 */
releasesRouter.get('/check', wrap(async (req, res) => {
  const { platform, arch, version, channel = 'stable' } = req.query;
  const current = String(version ?? '0.0.0');
  const row = await findLatest({ platform, arch, channel });
  const latest = toPublicRelease(row);

  const updateAvailable = !!latest && cmpSemver(latest.version, current) > 0;
  const mandatory = updateAvailable && (!!latest.mandatory || (!!latest.minVersion && cmpSemver(current, latest.minVersion) < 0));

  res.json({ updateAvailable, current, latest, mandatory });
}));
