/** Bài viết công khai (đã publish). Bản nháp chỉ thấy qua route admin. */
import { Router } from 'express';
import { Post } from '../models/Post.js';
import { wrap } from '../middleware/errors.js';

export const postsRouter = Router();

/** Bỏ `contentMd` khỏi danh sách — trang danh sách không cần markdown gốc, chỉ tốn băng thông. */
export function postToPublic(p, { withMarkdown = true } = {}) {
  const o = p.toObject ? p.toObject() : p;
  const out = {
    id: o._id,
    slug: o.slug,
    title: o.title,
    excerpt: o.excerpt ?? '',
    contentMd: o.contentMd ?? '',
    contentHtml: o.contentHtml ?? '',
    coverImageUrl: o.coverImageUrl ?? null,
    tags: o.tags ?? [],
    kind: o.kind,
    pinned: !!o.pinned,
    publishedAt: o.publishedAt ?? null,
    authorId: o.authorId ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
  if (!withMarkdown) delete out.contentMd;
  return out;
}

postsRouter.get('/', wrap(async (req, res) => {
  const { kind = 'post', tag } = req.query;
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 1), 100);

  const filter = { publishedAt: { $ne: null, $lte: Date.now() } };
  if (kind) filter.kind = kind;
  if (tag) filter.tags = tag;

  const [items, total] = await Promise.all([
    Post.find(filter).sort({ pinned: -1, publishedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Post.countDocuments(filter),
  ]);

  res.json({ items: items.map((p) => postToPublic(p, { withMarkdown: false })), total, page, limit });
}));

postsRouter.get('/:slug', wrap(async (req, res) => {
  const post = await Post.findOne({ slug: req.params.slug, publishedAt: { $ne: null, $lte: Date.now() } }).lean();
  if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
  res.json({ post: postToPublic(post) });
}));
