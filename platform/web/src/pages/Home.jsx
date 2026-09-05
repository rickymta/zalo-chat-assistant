import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../site.jsx';
import { useFetch } from '../lib/useFetch.js';
import { TargetCard } from '../components/ReleaseCard.jsx';
import { EmptyState, Loading } from '../components/ui.jsx';
import { TARGETS, detectTarget } from '../lib/platform.js';
import { formatDate } from '../lib/format.js';

/** Tính năng mặc định khi quản trị viên chưa cấu hình gì trong màn Trang chủ. */
const DEFAULT_FEATURES = [
  {
    icon: '📱',
    title: 'Kết nối Zalo bằng mã QR',
    text: 'Quét mã một lần như Zalo Web. Ứng dụng chạy nền, tự nối lại khi máy thức dậy.',
  },
  {
    icon: '🔐',
    title: 'Tin nhắn mã hoá trên máy bạn',
    text: 'Nội dung, tên, số điện thoại được mã hoá AES-256-GCM bằng khoá riêng của tài khoản. Máy chủ không bao giờ nhận tin nhắn.',
  },
  {
    icon: '💡',
    title: 'Gợi ý trả lời từ Claude Cowork',
    text: 'Claude đọc hội thoại trong thư mục làm việc rồi đề xuất câu trả lời; bạn sửa lại và bấm Gửi.',
  },
  {
    icon: '📊',
    title: 'Báo cáo ngày',
    text: 'Tổng hợp hội thoại trong ngày: số tin đến/đi, khách chưa được trả lời, việc cần làm.',
  },
  {
    icon: '🗂️',
    title: 'Thư mục làm việc gọn gàng',
    text: 'Hội thoại xuất ra Markdown/CSV/Excel trong ~/Documents/Zalo Chat Assistant để Claude đọc.',
  },
  {
    icon: '🔄',
    title: 'Tự kiểm tra bản mới',
    text: 'Ứng dụng báo khi có phiên bản mới và dẫn thẳng tới trang tải về.',
  },
];

export default function Home() {
  const { site } = useSite();
  const [target, setTarget] = useState(null);
  const { data: postsData } = useFetch('/api/posts?kind=post&limit=6', { auth: false });

  useEffect(() => {
    detectTarget().then(setTarget);
  }, []);

  const features = site.features && site.features.length ? site.features : DEFAULT_FEATURES;
  const latest = site.latest || {};
  const posts = postsData && postsData.items ? postsData.items : [];
  // Bài ghim lên trước, tối đa 3 bài trên trang chủ.
  const highlighted = [...posts].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).slice(0, 3);

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div className="hero-inner">
            <div>
              {site.tagline && <span className="tagline">✨ {site.tagline}</span>}
              <h1>{(site.hero && site.hero.title) || site.appName}</h1>
              <p className="sub">{site.hero && site.hero.subtitle}</p>
              <div className="cta">
                <Link to="/tai-ve" className="btn primary xl">
                  ⬇️ Tải ứng dụng
                </Link>
                <Link to="/huong-dan" className="btn xl">
                  Xem hướng dẫn
                </Link>
              </div>
              <p className="small faint" style={{ marginTop: 14 }}>
                Dành cho tư vấn viên MedDental. Máy chủ chỉ giữ tài khoản và chuỗi mã hoá — tin nhắn
                nằm trên máy bạn.
              </p>
            </div>

            {/* Minh hoạ giao diện ứng dụng, dựng bằng CSS cho nhẹ */}
            <div className="hero-art" aria-hidden="true">
              <div className="art-head">
                <i />
                <i />
                <i />
                <span className="small muted" style={{ marginLeft: 6 }}>
                  Hội thoại · Chị Lan (khách hàng)
                </span>
              </div>
              <div className="art-body">
                <div className="bubble">
                  <div className="who">Chị Lan · 09:12</div>
                  Niềng răng trong suốt bên em bao nhiêu tiền ạ?
                </div>
                <div className="bubble out">
                  <div className="who">Bạn · 09:14</div>
                  Dạ chị cho em xin tình trạng răng hiện tại ạ.
                </div>
                <div className="bubble tip">
                  <b>💡 Gợi ý của Claude</b>
                  Gửi bảng giá niềng trong suốt kèm mời chị đến chụp phim miễn phí trong tuần này.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>Ứng dụng làm được gì</h2>
            <p>
              Mọi tin nhắn đến và đi được lưu lại ngay trên máy, sẵn sàng cho Claude Cowork tổng hợp
              và đề xuất phản hồi.
            </p>
          </div>
          <div className="features">
            {features.map((f, i) => (
              <div className="feature" key={`${f.title}-${i}`}>
                <span className="ico">{f.icon || '•'}</span>
                <b>{f.title}</b>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2>Bản mới nhất</h2>
            <p>Chọn đúng bản cho máy của bạn. Không chắc dùng chip nào? Mở trang Tải về, chúng tôi tự nhận diện.</p>
          </div>
          <div className="dl-grid">
            {TARGETS.map((t) => (
              <TargetCard
                key={t.key}
                target={t}
                release={latest[t.key] || null}
                highlight={!!target && target.key === t.key}
              />
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <Link to="/tai-ve" className="btn">
              Trang tải về đầy đủ
            </Link>
            <Link to="/cap-nhat" className="btn">
              Có gì mới trong bản này?
            </Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2>Bắt đầu trong 4 bước</h2>
          </div>
          <div className="steps">
            <div className="step">
              <span className="n">1</span>
              <b>Cài ứng dụng</b>
              <p>
                Tải file cài, kéo vào Applications. Lần đầu trên macOS: <b>chuột phải → Mở</b>.
              </p>
            </div>
            <div className="step">
              <span className="n">2</span>
              <b>Đăng nhập tài khoản</b>
              <p>Email + mật khẩu (có mã đăng ký nếu công ty yêu cầu). Ứng dụng tự mở khoá các lần sau.</p>
            </div>
            <div className="step">
              <span className="n">3</span>
              <b>Quét mã QR Zalo</b>
              <p>Zalo trên điện thoại → biểu tượng QR → quét → Đồng ý. Để ứng dụng chạy nền.</p>
            </div>
            <div className="step">
              <span className="n">4</span>
              <b>Trỏ Claude Cowork</b>
              <p>
                Trỏ Cowork vào <code>~/Documents/Zalo Chat Assistant</code> một lần, rồi bấm 📁 Cập
                nhật dữ liệu cho Claude.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2>Bài viết mới</h2>
              <p>Ghi chú phát hành, mẹo dùng và thông báo dành cho tư vấn viên.</p>
            </div>
            <Link to="/bai-viet" className="btn sm">
              Xem tất cả
            </Link>
          </div>
          {!postsData ? (
            <Loading />
          ) : highlighted.length === 0 ? (
            <EmptyState icon="📝" title="Chưa có bài viết nào" hint="Bài viết mới sẽ hiện ở đây." />
          ) : (
            <div className="post-grid">
              {highlighted.map((p) => (
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
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
