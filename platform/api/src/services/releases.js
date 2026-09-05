/** Chuẩn hoá bản phát hành ra JSON + chọn bản mới nhất theo nền tảng/kiến trúc/kênh. */
import { config } from '../config.js';
import { Release } from '../models/Release.js';
import { cmpSemver } from './semver.js';

/** `downloadUrl` = externalUrl nếu có, ngược lại đường tải của chính máy chủ này. */
export function toPublicRelease(r) {
  if (!r) return null;
  const doc = r.toObject ? r.toObject() : r;
  const downloadUrl = doc.externalUrl
    ? doc.externalUrl
    : doc.fileName
      ? `${config.publicUrl}/downloads/${doc._id}/${encodeURIComponent(doc.fileName)}`
      : null;
  return {
    id: doc._id,
    version: doc.version,
    channel: doc.channel,
    platform: doc.platform,
    arch: doc.arch,
    fileName: doc.fileName ?? null,
    fileSize: doc.fileSize ?? 0,
    sha256: doc.sha256 ?? null,
    downloadUrl,
    externalUrl: doc.externalUrl ?? null,
    notes: doc.notes ?? '',
    notesHtml: doc.notesHtml ?? '',
    mandatory: !!doc.mandatory,
    minVersion: doc.minVersion ?? null,
    publishedAt: doc.publishedAt ?? null,
    downloads: doc.downloads ?? 0,
    createdAt: doc.createdAt,
    createdBy: doc.createdBy ?? null,
  };
}

/** Sắp xếp semver giảm dần; cùng version thì bản publish sau đứng trước. */
export function sortByVersionDesc(list) {
  return [...list].sort((a, b) => cmpSemver(b.version, a.version) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

/**
 * Bản mới nhất đã publish. Có `arch` ⇒ ưu tiên đúng arch, không có thì lùi về `universal`.
 * Không truyền `arch` ⇒ nhận mọi arch.
 */
export async function findLatest({ platform, arch, channel = 'stable' }) {
  const filter = { publishedAt: { $ne: null }, channel };
  if (platform) filter.platform = platform;
  if (arch) filter.arch = { $in: [arch, 'universal'] };

  const rows = await Release.find(filter).lean();
  if (!rows.length) return null;

  if (arch) {
    const exact = sortByVersionDesc(rows.filter((r) => r.arch === arch));
    if (exact.length) return exact[0];
    const universal = sortByVersionDesc(rows.filter((r) => r.arch === 'universal'));
    return universal[0] ?? null;
  }
  return sortByVersionDesc(rows)[0] ?? null;
}
