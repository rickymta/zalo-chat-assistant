/** Bài viết CMS. `contentHtml` do MÁY CHỦ render (marked + sanitize-html) — client không tự dựng HTML từ markdown. */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    excerpt: { type: String, default: '' },
    contentMd: { type: String, default: '' },
    contentHtml: { type: String, default: '' },
    coverImageUrl: { type: String, default: null },
    tags: { type: [String], default: [] },
    kind: { type: String, enum: ['post', 'page', 'changelog'], default: 'post', index: true },
    pinned: { type: Boolean, default: false },
    publishedAt: { type: Number, default: null },
    authorId: { type: String, default: null },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
  },
  { versionKey: false, _id: false },
);

export const Post = mongoose.model('Post', schema, 'posts');
