import { Link } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import PostCard from '../components/PostCard.jsx';
import { SourceIcon } from '../components/Brand.jsx';

/** Trang Hướng dẫn: liệt kê các bài kind=page do quản trị viên soạn trong CMS. */
export default function Guide() {
  usePageTitle('Hướng dẫn sử dụng');
  const { data, loading, error, reload } = useFetch('/api/posts?kind=page&limit=50', { auth: false });
  const items = (data && data.items) || [];

  return (
    <div className="wrap">
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Hướng dẫn sử dụng</h1>
            <p>
              Cài đặt, kết nối bốn nguồn (Zalo, Telegram, Email, Lark), bật AI cục bộ và nhận bản tin
              giọng nói.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="ico">🚀</span>
            <h3>Bắt đầu nhanh</h3>
          </div>
          <ol className="prose" style={{ paddingLeft: 22, marginTop: 10 }}>
            <li>
              <Link to="/tai-ve">Tải và cài ứng dụng</Link> — macOS lần đầu nhớ <b>chuột phải → Mở</b>.
            </li>
            <li>Đăng nhập tài khoản ứng dụng (một lần; các lần sau tự mở khoá).</li>
            <li>
              Vào <b>Kết nối</b> ở thanh trái: quét QR <b>Zalo</b>, đăng nhập <b>Telegram</b>, điền{' '}
              <b>Email IMAP</b> và <b>Lark Approval</b>. Mỗi thẻ có <b>Kiểm tra kết nối</b>.
            </li>
            <li>
              Ở thẻ <b>Bộ máy AI</b> chọn <b>AI cục bộ</b> và tải model; đặt <b>Bot Telegram gửi bản
              tin</b> để nhận bản tin giọng nói lúc 07:30 và 17:30.
            </li>
            <li>
              Mở <b>📊 Báo cáo</b> để xem tổng hợp trong ngày: số hội thoại, tin chưa trả lời, việc cần
              làm.
            </li>
          </ol>
          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <SourceIcon kind="zalo" />
            <SourceIcon kind="telegram" />
            <SourceIcon kind="email" />
            <SourceIcon kind="lark" />
            <span className="small muted" style={{ marginLeft: 4 }}>
              Zalo đọc &amp; trả lời; Telegram, Email, Lark chỉ đọc — ứng dụng không gửi gì thay bạn.
            </span>
          </div>
          <div className="hint" style={{ marginTop: 14 }}>
            <b>Lưu ý:</b> hội thoại Zalo 1-1 chỉ có tin từ lúc bạn kết nối trở đi (Zalo không cho lấy
            lịch sử cũ). Đừng mở <b>chat.zalo.me</b> trên trình duyệt khi ứng dụng đang chạy.
          </div>
        </div>

        <ErrorBox error={error} onRetry={reload} />

        <section>
          <div className="section-head" style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 24 }}>Tất cả bài hướng dẫn</h2>
          </div>
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
                <PostCard key={p.id} post={p} to={`/huong-dan/${p.slug}`} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
