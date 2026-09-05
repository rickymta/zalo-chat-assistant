import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { EmptyState, ErrorBox, Loading, Pagination } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';
import { qs } from '../api.js';

const LIMIT = 12;

export default function Posts() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') || 1));
  const tag = params.get('tag') || '';

  const { data, loading, error, reload } = useFetch(
    `/api/posts${qs({ kind: 'post', tag, page, limit: LIMIT })}`,
    { auth: false, deps: [page, tag] },
  );

  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;

  const goPage = (p) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  return (
    <div className="wrap">
      <div className="stack">
        <div>
          <h1>Bài viết</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Thông báo, ghi chú phát hành và mẹo dùng Zalo Chat Assistant.
          </p>
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
              {items.map((p) => (
                <Link key={p.id} to={`/bai-viet/${p.slug}`} className="post-card">
                  {p.coverImageUrl ? (
                    <img className="cover" src={p.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="cover ph">📄</div>
                  )}
                  <div className="body">
                    <h3>{p.title}</h3>
                    <p className="excerpt">{p.excerpt}</p>
                    <div className="foot">
                      {p.pinned && <span className="tag">📌 Ghim</span>}
                      <span>{formatDate(p.publishedAt)}</span>
                      {p.tags && p.tags.length > 0 && (
                        <span className="tags">
                          {p.tags.slice(0, 2).map((t) => (
                            <span key={t} className="tag plain">
                              {t}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination page={page} total={total} limit={LIMIT} onChange={goPage} />
          </>
        )}
      </div>
    </div>
  );
}
