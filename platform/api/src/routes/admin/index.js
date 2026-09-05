/** Gom mọi route quản trị dưới `/api/admin/*` — toàn bộ đều yêu cầu đăng nhập + vai trò admin. */
import { Router } from 'express';
import { requireUser, requireAdmin } from '../../middleware/auth.js';
import { adminReleasesRouter } from './releases.js';
import { adminPostsRouter } from './posts.js';
import { adminUploadsRouter } from './uploads.js';
import { adminUsersRouter } from './users.js';
import { adminStatsRouter } from './stats.js';
import { adminSiteRouter } from './site.js';

export const adminRouter = Router();

adminRouter.use(requireUser, requireAdmin);
adminRouter.use('/releases', adminReleasesRouter);
adminRouter.use('/posts', adminPostsRouter);
adminRouter.use('/uploads', adminUploadsRouter);
adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/stats', adminStatsRouter);
adminRouter.use('/site', adminSiteRouter);
