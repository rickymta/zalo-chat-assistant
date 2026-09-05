import { Link } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';

/** Trang Hướng dẫn: liệt kê các bài kind=page do quản trị viên soạn trong CMS. */
export default function Guide() {
  const { data, loading, error, reload } = useFetch('/api/posts?kind=page&limit=50', { auth: false });
  const items = (data && data.items) || [];

  return (
    <div className="wrap">
      <div className="stack">
        <div>
          <h1>Hướng dẫn sử dụng</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Các bài hướng dẫn cài đặt, kết nối Zalo và làm việc với Claude Cowork.
          </p>
        </div>

        <div className="card">
          <h3>Bắt đầu nhanh</h3>
          <ol className="prose" style={{ paddingLeft: 22, marginTop: 10 }}>
            <li>
              <Link to="/tai-ve">Tải và cài ứng dụng</Link> — macOS lần đầu nhớ <b>chuột phải → Mở</b>.
            </li>
            <li>
              Đăng nhập tài khoản ứng dụng, rồi ở thanh trên bấm <b>Đăng nhập Zalo (QR)</b> và quét mã
              bằng Zalo trên điện thoại.
            </li>
            <li>
              Trỏ Claude Cowork vào thư mục <code>~/Documents/Zalo Chat Assistant</code>, bấm{' '}
              <b>📁 Cập nhật dữ liệu cho Claude</b>, rồi nhờ Claude tổng hợp hội thoại.
            </li>
            <li>
              Mở <b>📊 Báo cáo ngày</b> để xem tổng hợp: số hội thoại, tin chưa trả lời, việc cần làm.
            </li>
          </ol>
          <div className="hint" style={{ marginTop: 14 }}>
            <b>Lưu ý quan trọng:</b> hội thoại 1-1 chỉ có tin từ lúc bạn kết nối Zalo trở đi (Zalo
            không cho lấy lịch sử cũ). Đừng mở <b>chat.zalo.me</b> trên trình duyệt khi ứng dụng đang
            chạy.
          </div>
        </div>

        <ErrorBox error={error} onRetry={reload} />

        <section>
          <h2 style={{ marginBottom: 16 }}>Tất cả bài hướng dẫn</h2>
          {loading ? (
            <Loading text="Đang tải hướng dẫn…" />
          ) : items.length === 0 ? (
            <EmptyState
              icon="📘"
              title="Chưa có bài hướng dẫn nào"
              hint="Quản trị viên soạn bài dạng “Trang” trong khu quản trị, bài sẽ hiện tại đây."
            />
          ) : (
            <div className="post-grid">
              {items.map((p) => (
                <Link key={p.id} to={`/huong-dan/${p.slug}`} className="post-card">
                  {p.coverImageUrl ? (
                    <img className="cover" src={p.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="cover ph">📘</div>
                  )}
                  <div className="body">
                    <h3>{p.title}</h3>
                    <p className="excerpt">{p.excerpt}</p>
                    <div className="foot">
                      {p.pinned && <span className="tag">📌 Ghim</span>}
                      <span>{formatDate(p.publishedAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
