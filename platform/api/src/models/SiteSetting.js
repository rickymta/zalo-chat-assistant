/** Cấu hình trang chủ — một bản ghi duy nhất `_id: 'site'`. */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'site' },
    appName: { type: String, default: 'Zalo Chat Assistant' },
    tagline: { type: String, default: '' },
    hero: {
      title: { type: String, default: '' },
      subtitle: { type: String, default: '' },
    },
    features: {
      type: [{ _id: false, icon: String, title: String, text: String }],
      default: [],
    },
    contact: {
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      zalo: { type: String, default: '' },
      address: { type: String, default: '' },
      website: { type: String, default: '' },
    },
    updatedAt: { type: Number, default: () => Date.now() },
  },
  { versionKey: false, _id: false, minimize: false },
);

export const SiteSetting = mongoose.model('SiteSetting', schema, 'site_settings');
