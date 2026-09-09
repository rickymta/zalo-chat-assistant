import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { ErrorBox, Loading, Prose } from '../components/ui.jsx';
import PostCard from '../components/PostCard.jsx';
import { formatDate } from '../lib/format.js';
import NotFound from './NotFound.jsx';

const KIND_LABEL = { page: 'Hướng dẫn', changelog: 'Ghi chú phát hành', post: 'Bài viết' };

export default function PostDetail({ backTo = '/bai-viet' }) {
  const { slug } = useParams();
  const { data, loading, error, reload } = useFetch(`/api/posts/${encodeURIComponent(slug)}`, {
    auth: false,
    deps: [slug],
  });

  const post = data && data.post;
  const isGuide = backTo === '/huong-dan';

  // Đổi tiêu đề tab cho dễ nhận ra khi mở nhiều bài.
  usePageTitle(post && post.title ? post.title : '');

  // Bài liên quan: cùng loại, mới nhất — bỏ chính bài đang đọc.
  const kind = post ? post.kind : null;
  const { data: relatedData } = useFetch(kind ? `/api/posts?kind=${encodeURIComponent(kind)}&limit=4` : null, {
    auth: false,
    deps: [kind],
  });
  const related = ((relatedData && relatedData.items) || []).filter((p) => p.slug !== slug).slice(0, 3);

  if (loading) {
    return (
      <div className="wrap">
        <Loading text="Đang tải bài viết…" />
      </div>
    );
  }

  // Không có bài ⇒ 404 (API trả 404 khi slug sai hoặc bài còn nháp).
  if (error && error.status === 404) return <NotFound />;

  if (error) {
    return (
      <div className="wrap">
        <ErrorBox error={error} onRetry={reload} />
      </div>
    );
  }

  if (!post) return <NotFound />;

  const label = KIND_LABEL[post.kind] || 'Bài viết';
  const backLabel = isGuide ? 'Hướng dẫn' : 'Bài viết';

  return (
    <div className="wrap">
      <article className="article">
        <div style={{ marginBottom: 20 }}>
          <Link to={backTo} className="back-link">
            ← Quay lại {backLabel}
          </Link>
        </div>

        {post.coverImageUrl && (
          <div className="article-hero">
            <img src={post.coverImageUrl} alt="" />
          </div>
        )}

        <h1>{post.title}</h1>
        <div className="byline">
          <span className="pill info">{label}</span>
          <span>{formatDate(post.publishedAt)}</span>
          {post.pinned && <span className="tag">📌 Ghim</span>}
          {post.tags && post.tags.length > 0 && (
            <span className="tags">
              {post.tags.map((t) => (
                <Link key={t} className="tag plain" to={`/bai-viet?tag=${encodeURIComponent(t)}`}>
                  {t}
                </Link>
              ))}
            </span>
          )}
        </div>

        <Prose html={post.contentHtml} />

        <div className="article-foot">
          <Link to={backTo} className="back-link">
            ← Tất cả {backLabel.toLowerCase()}
          </Link>
          <Link to="/tai-ve" className="btn sm">
            Tải ứng dụng
          </Link>
        </div>
      </article>

      {related.length > 0 && (
        <section className="section" style={{ paddingBottom: 0 }}>
          <div className="section-head" style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 24 }}>{isGuide ? 'Hướng dẫn khác' : 'Bài viết khác'}</h2>
          </div>
          <div className="post-grid">
            {related.map((p) => (
              <PostCard key={p.id} post={p} to={isGuide ? `/huong-dan/${p.slug}` : undefined} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
