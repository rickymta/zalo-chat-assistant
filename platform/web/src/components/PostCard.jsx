import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format.js';
import { BrandMark } from './Brand.jsx';

const KIND_LABEL = { page: 'Hướng dẫn', changelog: 'Ghi chú phát hành', post: 'Bài viết' };

/**
 * Thẻ một bài viết/hướng dẫn: ảnh bìa 16:9 (API trả `coverImageUrl` dạng /uploads/…),
 * tiêu đề, trích đoạn, ngày và thẻ. Không có ảnh bìa ⇒ nền gradient + logo.
 * `featured` = thẻ lớn trải hết bề ngang (bài đầu trang danh sách).
 */
export default function PostCard({ post, to, featured = false, showKind = false, maxTags = 2 }) {
  const href = to || `/bai-viet/${post.slug}`;
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, maxTags) : [];
  return (
    <Link to={href} className={`post-card${featured ? ' featured' : ''}`}>
      <div className="cover-wrap">
        {post.coverImageUrl ? (
          <img className="cover" src={post.coverImageUrl} alt="" loading={featured ? 'eager' : 'lazy'} />
        ) : (
          <div className="cover ph" aria-hidden="true">
            <BrandMark size={56} />
          </div>
        )}
        {(post.pinned || showKind) && (
          <div className="kicker">
            {post.pinned && <span className="pill">📌 Ghim</span>}
            {showKind && KIND_LABEL[post.kind] && <span className="pill">{KIND_LABEL[post.kind]}</span>}
          </div>
        )}
      </div>
      <div className="body">
        <h3>{post.title}</h3>
        {post.excerpt && <p className="excerpt">{post.excerpt}</p>}
        <div className="foot">
          <span>{formatDate(post.publishedAt)}</span>
          {tags.length > 0 && (
            <span className="tags">
              {tags.map((t) => (
                <span key={t} className="tag plain">
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
