/** Bản phát hành phần mềm. `publishedAt = null` nghĩa là bản nháp (không lộ ra route công khai). */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    version: { type: String, required: true },
    channel: { type: String, enum: ['stable', 'beta'], default: 'stable', index: true },
    platform: { type: String, enum: ['darwin', 'win32', 'linux'], required: true, index: true },
    arch: { type: String, enum: ['arm64', 'x64', 'universal'], required: true, index: true },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: 0 },
    sha256: { type: String, default: null },
    externalUrl: { type: String, default: null },
    notes: { type: String, default: '' },
    notesHtml: { type: String, default: '' },
    mandatory: { type: Boolean, default: false },
    minVersion: { type: String, default: null },
    publishedAt: { type: Number, default: null },
    downloads: { type: Number, default: 0 },
    createdAt: { type: Number, required: true },
    createdBy: { type: String, default: null },
  },
  { versionKey: false, _id: false },
);

export const Release = mongoose.model('Release', schema, 'releases');
