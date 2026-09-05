import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';
import NotFound from './NotFound.jsx';

export default function PostDetail({ backTo = '/bai-viet' }) {
  const { slug } = useParams();
  const { data, loading, error, reload } = useFetch(`/api/posts/${encodeURIComponent(slug)}`, {
    auth: false,
    deps: [slug],
  });

  const post = data && data.post;

  // Đổi tiêu đề tab cho dễ nhận ra khi mở nhiều bài.
  useEffect(() => {
    if (post && post.title) document.title = `${post.title} — Zalo Chat Assistant`;
    return () => {
      document.title = 'Zalo Chat Assistant';
    };
  }, [post]);

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

  const label = post.kind === 'page' ? 'Hướng dẫn' : post.kind === 'changelog' ? 'Ghi chú phát hành' : 'Bài viết';

  return (
    <div className="wrap">
      <div style={{ marginBottom: 18 }}>
        <Link to={backTo} className="btn sm">
          ← Quay lại {backTo === '/huong-dan' ? 'Hướng dẫn' : 'Bài viết'}
        </Link>
      </div>

      <article className="article">
        {post.coverImageUrl && <img className="cover" src={post.coverImageUrl} alt="" />}
        <h1>{post.title}</h1>
        <div className="byline">
          <span className="pill">{label}</span>
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
      </article>
    </div>
  );
}
