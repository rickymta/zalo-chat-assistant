import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { EmptyState, ErrorBox, Loading, Pagination } from '../components/ui.jsx';
import PostCard from '../components/PostCard.jsx';
import { qs } from '../api.js';

const LIMIT = 12;

export default function Posts() {
  usePageTitle('Bài viết');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') || 1));
  const tag = params.get('tag') || '';

  const { data, loading, error, reload } = useFetch(
    `/api/posts${qs({ kind: 'post', tag, page, limit: LIMIT })}`,
    { auth: false, deps: [page, tag] },
  );

  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  // Trang đầu, không lọc thẻ ⇒ bài đầu tiên (bài ghim nếu có) hiện dạng thẻ lớn.
  const featureFirst = page === 1 && !tag && items.length > 1;

  const goPage = (p) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  return (
    <div className="wrap">
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Bài viết</h1>
            <p>Thông báo, ghi chú phát hành và mẹo dùng Work Assistant.</p>
          </div>
          {total > 0 && <span className="pill">{total} bài</span>}
        </div>

        {tag && (
          <div className="row">
            <span className="muted">Đang lọc theo thẻ:</span>
            <span className="tag">{tag}</span>
            <button
              type="button"
              className="sm"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('tag');
                next.delete('page');
                setParams(next);
              }}
            >
              Bỏ lọc
            </button>
          </div>
        )}

        <ErrorBox error={error} onRetry={reload} />

        {loading ? (
          <Loading text="Đang tải bài viết…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="📝"
            title="Chưa có bài viết nào"
            hint={tag ? 'Không có bài nào mang thẻ này.' : 'Bài viết mới sẽ hiện ở đây.'}
          />
        ) : (
          <>
            <div className="post-grid">
              {items.map((p, i) => (
                <PostCard key={p.id} post={p} featured={featureFirst && i === 0} />
              ))}
            </div>
            <Pagination page={page} total={total} limit={LIMIT} onChange={goPage} />
          </>
        )}
      </div>
    </div>
  );
}
