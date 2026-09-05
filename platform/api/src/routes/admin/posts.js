/** Quản trị bài viết CMS. `contentHtml` luôn render lại ở máy chủ — không nhận HTML do client gửi lên. */
import crypto from 'node:crypto';
import { Router } from 'express';
import { Post } from '../../models/Post.js';
import { renderMarkdown, autoExcerpt } from '../../services/markdown.js';
import { uniqueSlug, slugify } from '../../services/slug.js';
import { postToPublic } from '../posts.js';
import { wrap } from '../../middleware/errors.js';

const KINDS = ['post', 'page', 'changelog'];
const bool = (v, fallback = false) => (v === undefined || v === null || v === '' ? fallback : v === true || v === 'true' || v === '1');

export const adminPostsRouter = Router();

adminPostsRouter.get('/', wrap(async (req, res) => {
  const { kind, tag, q } = req.query;
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

  const filter = {};
  if (kind) filter.kind = kind;
  if (tag) filter.tags = tag;
  if (q) filter.title = { $regex: String(q).slice(0, 100), $options: 'i' };

  const [items, total] = await Promise.all([
    Post.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Post.countDocuments(filter),
  ]);
  res.json({ items: items.map((p) => postToPublic(p, { withMarkdown: false })), total, page, limit });
}));

adminPostsRouter.get('/:id', wrap(async (req, res) => {
  const post = await Post.findById(req.params.id).lean();
  if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
  res.json({ post: postToPublic(post) });
}));

adminPostsRouter.post('/', wrap(async (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Tiêu đề không được để trống.' });
  const kind = KINDS.includes(b.kind) ? b.kind : 'post';
  const contentMd = String(b.contentMd ?? '');
  const now = Date.now();

  const doc = await Post.create({
    _id: crypto.randomUUID(),
    slug: await uniqueSlug(Post, String(b.slug ?? '').trim() || title),
    title,
    excerpt: String(b.excerpt ?? '').trim() || autoExcerpt(contentMd),
    contentMd,
    contentHtml: renderMarkdown(contentMd),
    coverImageUrl: String(b.coverImageUrl ?? '').trim() || null,
    tags: Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    kind,
    pinned: bool(b.pinned),
    publishedAt: bool(b.published) ? (Number(b.publishedAt) || now) : null,
    authorId: req.user._id,
    createdAt: now,
    updatedAt: now,
  });
  res.json({ post: postToPublic(doc) });
}));

adminPostsRouter.put('/:id', wrap(async (req, res) => {
  const doc = await Post.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
  const b = req.body ?? {};

  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return res.status(400).json({ error: 'Tiêu đề không được để trống.' });
    doc.title = title;
  }
  if (b.slug !== undefined) {
    const wanted = String(b.slug ?? '').trim();
    doc.slug = await uniqueSlug(Post, wanted || doc.title, doc._id);
  }
  if (b.contentMd !== undefined) {
    doc.contentMd = String(b.contentMd);
    doc.contentHtml = renderMarkdown(doc.contentMd);
    if (!String(b.excerpt ?? '').trim() && !doc.excerpt) doc.excerpt = autoExcerpt(doc.contentMd);
  }
  if (b.excerpt !== undefined) doc.excerpt = String(b.excerpt);
  if (b.coverImageUrl !== undefined) doc.coverImageUrl = String(b.coverImageUrl ?? '').trim() || null;
  if (b.tags !== undefined) doc.tags = Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [];
  if (b.kind !== undefined && KINDS.includes(b.kind)) doc.kind = b.kind;
  if (b.pinned !== undefined) doc.pinned = bool(b.pinned);
  if (b.published !== undefined) doc.publishedAt = bool(b.published) ? (doc.publishedAt ?? Date.now()) : null;
  if (b.publishedAt !== undefined && b.publishedAt !== null) doc.publishedAt = Number(b.publishedAt) || doc.publishedAt;

  doc.updatedAt = Date.now();
  await doc.save();
  res.json({ post: postToPublic(doc) });
}));

adminPostsRouter.delete('/:id', wrap(async (req, res) => {
  const doc = await Post.findByIdAndDelete(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
  res.json({ ok: true });
}));

export { slugify };
