/** Nội dung trang chủ công khai: cấu hình do admin đặt + bản mới nhất của 3 nền tảng phổ biến. */
import { Router } from 'express';
import { config } from '../config.js';
import { SiteSetting } from '../models/SiteSetting.js';
import { toPublicRelease, findLatest } from '../services/releases.js';
import { wrap } from '../middleware/errors.js';

export const siteRouter = Router();

const DEFAULTS = {
  appName: () => config.appName,
  tagline: 'Trợ lý trả lời tin nhắn Zalo cho phòng khám',
  hero: { title: 'Zalo Chat Assistant', subtitle: 'Đăng nhập Zalo bằng QR, lưu hội thoại vào máy bạn, để Claude gợi ý câu trả lời.' },
  features: [],
  contact: { email: '', phone: '', zalo: '', address: '', website: '' },
};

/** Lấy (hoặc tạo lần đầu) bản ghi cấu hình duy nhất. */
export async function getSiteSetting() {
  const existing = await SiteSetting.findById('site');
  if (existing) return existing;
  return SiteSetting.create({
    _id: 'site',
    appName: DEFAULTS.appName(),
    tagline: DEFAULTS.tagline,
    hero: DEFAULTS.hero,
    features: DEFAULTS.features,
    contact: DEFAULTS.contact,
    updatedAt: Date.now(),
  });
}

export function siteToPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    appName: o.appName || config.appName,
    tagline: o.tagline ?? '',
    hero: { title: o.hero?.title ?? '', subtitle: o.hero?.subtitle ?? '' },
    features: (o.features ?? []).map((f) => ({ icon: f.icon ?? '', title: f.title ?? '', text: f.text ?? '' })),
    contact: {
      email: o.contact?.email ?? '',
      phone: o.contact?.phone ?? '',
      zalo: o.contact?.zalo ?? '',
      address: o.contact?.address ?? '',
      website: o.contact?.website ?? '',
    },
  };
}

siteRouter.get('/', wrap(async (_req, res) => {
  const doc = await getSiteSetting();
  const [darwinArm64, darwinX64, win32X64] = await Promise.all([
    findLatest({ platform: 'darwin', arch: 'arm64' }),
    findLatest({ platform: 'darwin', arch: 'x64' }),
    findLatest({ platform: 'win32', arch: 'x64' }),
  ]);
  res.json({
    ...siteToPublic(doc),
    latest: {
      'darwin-arm64': toPublicRelease(darwinArm64),
      'darwin-x64': toPublicRelease(darwinX64),
      'win32-x64': toPublicRelease(win32X64),
    },
  });
}));
