/** Đọc/ghi cấu hình trang chủ (phần `GET /api/site` trừ `latest`). */
import { Router } from 'express';
import { getSiteSetting, siteToPublic } from '../site.js';
import { wrap } from '../../middleware/errors.js';

export const adminSiteRouter = Router();

adminSiteRouter.get('/', wrap(async (_req, res) => {
  res.json(siteToPublic(await getSiteSetting()));
}));

adminSiteRouter.put('/', wrap(async (req, res) => {
  const doc = await getSiteSetting();
  const b = req.body ?? {};

  if (b.appName !== undefined) doc.appName = String(b.appName ?? '').trim();
  if (b.tagline !== undefined) doc.tagline = String(b.tagline ?? '').trim();
  if (b.hero !== undefined) {
    doc.hero = {
      title: String(b.hero?.title ?? '').trim(),
      subtitle: String(b.hero?.subtitle ?? '').trim(),
    };
  }
  if (b.features !== undefined) {
    doc.features = (Array.isArray(b.features) ? b.features : []).slice(0, 24).map((f) => ({
      icon: String(f?.icon ?? '').slice(0, 40),
      title: String(f?.title ?? '').slice(0, 120),
      text: String(f?.text ?? '').slice(0, 600),
    }));
  }
  if (b.contact !== undefined) {
    doc.contact = {
      email: String(b.contact?.email ?? '').trim(),
      phone: String(b.contact?.phone ?? '').trim(),
      zalo: String(b.contact?.zalo ?? '').trim(),
      address: String(b.contact?.address ?? '').trim(),
      website: String(b.contact?.website ?? '').trim(),
    };
  }

  doc.updatedAt = Date.now();
  await doc.save();
  res.json(siteToPublic(doc));
}));
