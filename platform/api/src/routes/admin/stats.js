/** Số liệu tổng quan cho bảng điều khiển quản trị. */
import { Router } from 'express';
import { User } from '../../models/User.js';
import { Release } from '../../models/Release.js';
import { Post } from '../../models/Post.js';
import { DownloadEvent } from '../../models/DownloadEvent.js';
import { wrap } from '../../middleware/errors.js';

export const adminStatsRouter = Router();

adminStatsRouter.get('/', wrap(async (_req, res) => {
  const weekAgo = Date.now() - 7 * 86400e3;

  const [users, usersNew7d, releases, posts, downloads7d, sum, lastLoginRows] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    Release.countDocuments({}),
    Post.countDocuments({}),
    DownloadEvent.countDocuments({ at: { $gte: weekAgo } }),
    Release.aggregate([{ $group: { _id: null, total: { $sum: '$downloads' } } }]),
    User.find({ lastLoginAt: { $ne: null } }).sort({ lastLoginAt: -1 }).limit(10).lean(),
  ]);

  res.json({
    users,
    usersNew7d,
    releases,
    downloadsTotal: sum[0]?.total ?? 0,
    downloads7d,
    posts,
    lastLogins: lastLoginRows.map((u) => ({ id: u._id, email: u.email, name: u.name ?? null, lastLoginAt: u.lastLoginAt })),
  });
}));
