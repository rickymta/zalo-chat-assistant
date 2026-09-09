import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { EmptyState, ErrorBox, Loading, Pagination } from '../components/ui.jsx';
import PostCard from '../components/PostCard.jsx';
import { qs } from '../api.js';

const LIMIT = 12;

// Bộ lọc theo loại: "Tất cả" gộp cả ba loại; các mục còn lại lọc từng loại.
const TYPES = [
  { value: '', label: 'Tất cả', kind: 'post,page,changelog' },
  { value: 'post', label: 'Bài viết', kind: 'post' },
  { value: 'page', label: 'Hướng dẫn', kind: 'page' },
  { value: 'changelog', label: 'Cập nhật', kind: 'changelog' },
];

// Bài dạng "page" mở ở /huong-dan; còn lại ở /bai-viet.
const linkTo = (p) => (p.kind === 'page' ? `/huong-dan/${p.slug}` : `/bai-viet/${p.slug}`);

export default function Posts() {
  usePageTitle('Bài viết');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') || 1));
  const tag = params.get('tag') || '';
  const type = params.get('type') || '';
  const activeType = TYPES.find((t) => t.value === type) || TYPES[0];

  const { data, loading, error, reload } = useFetch(
    `/api/posts${qs({ kind: activeType.kind, tag, page, limit: LIMIT })}`,
    { auth: false, deps: [page, tag, type] },
  );

  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  // Trang đầu, không lọc thẻ ⇒ bài đầu tiên (bài ghim nếu có) hiện dạng thẻ lớn.
  const featureFirst = page === 1 && !tag && items.length > 1;
  const single = items.length === 1;

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

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
            <p>Thông báo, ghi chú phát hành và hướng dẫn dùng Work Assistant.</p>
          </div>
          {/* Chỉ hiện số đếm khi đủ nhiều — 1–2 mục thì con số làm trang trông thiếu. */}
          {total >= 3 && <span className="pill">{total} bài</span>}
        </div>

        <div className="segmented" role="tablist" aria-label="Lọc theo loại bài">
          {TYPES.map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              role="tab"
              aria-selected={activeType.value === t.value}
              className={activeType.value === t.value ? 'active' : ''}
              onClick={() => setParam('type', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tag && (
          <div className="row">
            <span className="muted">Đang lọc theo thẻ:</span>
            <span className="tag">{tag}</span>
            <button type="button" className="sm" onClick={() => setParam('tag', '')}>
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
            title="Chưa có bài nào"
            hint={tag ? 'Không có bài nào mang thẻ này.' : 'Bài mới sẽ hiện ở đây.'}
          />
        ) : (
          <>
            <div className={`post-grid${single ? '' : items.length === 2 ? ' two' : ''}`}>
              {items.map((p, i) => (
                <PostCard
                  key={p.id}
                  post={p}
                  to={linkTo(p)}
                  showKind={!type}
                  featured={(featureFirst && i === 0) || single}
                />
              ))}
            </div>
            <Pagination page={page} total={total} limit={LIMIT} onChange={goPage} />
          </>
        )}
      </div>
    </div>
  );
}
