import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../site.jsx';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { TargetCard } from '../components/ReleaseCard.jsx';
import PostCard from '../components/PostCard.jsx';
import { EmptyState, Loading } from '../components/ui.jsx';
import { SOURCES, SourceIcon, FeatureIcon } from '../components/Brand.jsx';
import { TARGETS, detectTarget } from '../lib/platform.js';

/** Tính năng mặc định khi quản trị viên chưa cấu hình gì trong màn Trang chủ. */
const DEFAULT_FEATURES = [
  {
    glyph: 'cpu',
    title: 'AI chạy ngay trên máy bạn',
    text: 'Mô hình chạy ngay trên máy (tăng tốc Metal trên Apple Silicon) đọc hội thoại, thư và phiếu duyệt rồi gom việc cần làm theo từng người.',
  },
  {
    glyph: 'voice',
    title: 'Bản tin giọng nói theo giờ',
    text: 'Mỗi sáng 07:30 và chiều 17:30, một bản tin riêng cho từng kênh được đọc thành giọng nói và gửi qua bot Telegram kèm bản chữ.',
  },
  {
    glyph: 'lock',
    title: 'Mã hoá ngay trên máy bạn',
    text: 'Nội dung, tên, số điện thoại mã hoá AES-256-GCM bằng khoá riêng của tài khoản. Máy chủ không bao giờ nhận tin nhắn.',
  },
  {
    glyph: 'report',
    title: 'Báo cáo ngày',
    text: 'Tổng hợp cả ngày: số tin đến/đi, khách chưa được trả lời, việc đã chốt và việc còn dang dở của bạn.',
  },
  {
    glyph: 'reply',
    title: 'Gợi ý trả lời ngay cạnh hội thoại',
    text: 'Với Zalo, thẻ gợi ý hiện ngay trong khung chat — bấm Dùng gợi ý, sửa lại rồi Gửi. Không bao giờ tự gửi thay bạn.',
  },
  {
    glyph: 'refresh',
    title: 'Tự kiểm tra bản mới',
    text: 'Ứng dụng báo khi có phiên bản mới và dẫn thẳng tới trang tải về. Cài xong, tắt máy mở lại không phải đăng nhập lại.',
  },
];

const STEPS = [
  {
    title: 'Cài ứng dụng',
    text: (
      <>
        Tải bản cho máy của bạn, kéo vào Applications. Lần đầu trên macOS mở bằng{' '}
        <b style={{ whiteSpace: 'nowrap' }}>chuột phải → Mở.</b>
      </>
    ),
  },
  {
    title: 'Đăng nhập tài khoản',
    text: 'Email + mật khẩu (có mã đăng ký nếu công ty yêu cầu). Đăng nhập một lần, các lần sau tự mở khoá.',
  },
  {
    title: 'Kết nối nguồn',
    text: 'Màn Kết nối gom mọi khoá về một chỗ: quét QR Zalo, đăng nhập Telegram, điền email IMAP và Lark Approval.',
  },
  {
    title: 'Nhận bản tin',
    text: 'Đặt giờ và bot Telegram để nhận bản tin giọng nói; hoặc trỏ Claude Cowork vào thư mục làm việc để tự tổng hợp.',
  },
];

export default function Home() {
  usePageTitle('');
  const { site } = useSite();
  const [target, setTarget] = useState(null);
  // "Mới trên trang" gộp cả bài viết, hướng dẫn và ghi chú phát hành — máy chủ đã sắp ghim trước, mới trước.
  const { data: postsData } = useFetch('/api/posts?kind=post,page,changelog&limit=3', { auth: false });

  useEffect(() => {
    detectTarget().then(setTarget);
  }, []);

  const features = site.features && site.features.length ? site.features : DEFAULT_FEATURES;
  const latest = site.latest || {};
  const highlighted = (postsData && postsData.items) || [];

  const ctaLabel =
    target && target.supported
      ? target.platform === 'win32'
        ? 'Tải cho Windows'
        : 'Tải cho macOS'
      : 'Tải ứng dụng';
  // Có sẵn tệp cho đúng máy đang xem ⇒ nút hero tải thẳng; nếu không thì dẫn sang trang Tải về.
  const primaryRelease = target && target.supported ? latest[target.key] || null : null;
  const downloadHref = primaryRelease && primaryRelease.downloadUrl ? primaryRelease.downloadUrl : null;
  const linkTo = (p) => (p.kind === 'page' ? `/huong-dan/${p.slug}` : `/bai-viet/${p.slug}`);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-inner">
            <div>
              <span className="eyebrow">
                <span className="dot" aria-hidden="true">
                  ✦
                </span>
                {site.tagline || 'Trợ lý công việc đa nguồn'} · AI cục bộ
              </span>
              <h1>{(site.hero && site.hero.title) || site.appName}</h1>
              <p className="sub">{site.hero && site.hero.subtitle}</p>

              <div className="cta">
                {downloadHref ? (
                  <a href={downloadHref} download className="btn primary xl">
                    <DownloadGlyph />
                    {ctaLabel}
                  </a>
                ) : (
                  <Link to="/tai-ve" className="btn primary xl">
                    <DownloadGlyph />
                    {ctaLabel}
                  </Link>
                )}
                <Link to="/huong-dan" className="btn xl">
                  Xem hướng dẫn
                </Link>
              </div>
              <p className="cta-note">
                <Link to="/tai-ve">Bản khác &amp; hướng dẫn cài đặt →</Link>
              </p>
              <div className="trust">
                <span>🔒 Mã hoá trên máy</span>
                <span>💻 macOS &amp; Windows</span>
                <span>🛡️ Chỉ đọc, không gửi thay bạn</span>
              </div>
            </div>

            <HeroArt />
          </div>
        </div>
      </section>

      {/* ── Bốn nguồn ────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Bốn nguồn, một chỗ</span>
            <h2>Mọi việc cần bạn xử lý, gom về một hộp thư</h2>
            <p>
              Tin nhắn Zalo, nhóm Telegram, thư đến và phiếu duyệt Lark hiện chung một cột hội thoại —
              mỗi nguồn một huy hiệu, mỗi hội thoại một tóm tắt.
            </p>
          </div>
          <div className="sources">
            {SOURCES.map((s) => (
              <div className="source-card" key={s.key}>
                <SourceIcon kind={s.key} />
                <b>{s.label}</b>
                <p>{s.text}</p>
                <span className={`pill mode ${s.mode === 'Chỉ đọc' ? '' : 'info'}`.trim()}>{s.mode}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tính năng ────────────────────────────────────────────────────── */}
      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Tính năng</span>
            <h2>Ứng dụng làm được gì</h2>
            <p>
              Dữ liệu ở trên máy, AI cũng ở trên máy. Bạn nhận về việc cần làm — bằng chữ hoặc bằng
              giọng nói — mà không phải mở từng ứng dụng.
            </p>
          </div>
          <div className="features">
            {features.map((f, i) => (
              <div className="feature" key={`${f.title}-${i}`}>
                <FeatureIcon glyph={f.glyph} fallback={f.icon || '✦'} />
                <b>{f.title}</b>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bắt đầu ──────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Cách bắt đầu</span>
            <h2>Chạy được trong 4 bước</h2>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.title}>
                <span className="n">{i + 1}</span>
                <b>{s.title}</b>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tải về ───────────────────────────────────────────────────────── */}
      <section className="section alt" id="tai-ve">
        <div className="wrap">
          <div className="section-head split">
            <div>
              <span className="kicker">Tải về</span>
              <h2>Chọn bản cho máy của bạn</h2>
              <p>
                Không chắc máy dùng chip nào? Mở trang Tải về — chúng tôi tự nhận diện và gợi ý đúng bản.
              </p>
            </div>
            <Link to="/cap-nhat" className="btn">
              Có gì mới?
            </Link>
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
        </div>
      </section>

      {/* ── Bài viết ─────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="section-head split">
            <div>
              <span className="kicker">Bài viết</span>
              <h2>Mới trên trang</h2>
              <p>Ghi chú phát hành, mẹo dùng và thông báo dành cho người dùng nội bộ.</p>
            </div>
            <Link to="/bai-viet" className="btn">
              Xem tất cả
            </Link>
          </div>
          {!postsData ? (
            <Loading />
          ) : highlighted.length === 0 ? (
            <EmptyState icon="📝" title="Chưa có bài viết nào" hint="Bài viết mới sẽ hiện ở đây." />
          ) : (
            <div className={`post-grid${highlighted.length === 2 ? ' two' : ''}`}>
              {highlighted.map((p, i) => (
                <PostCard
                  key={p.id}
                  post={p}
                  to={linkTo(p)}
                  showKind
                  featured={highlighted.length === 1 && i === 0}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Kêu gọi cuối trang ───────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta-band">
            <div>
              <h2>Sáng mở máy, việc cần làm đã gom sẵn</h2>
              <p>
                Cài trong vài phút, kết nối nguồn một lần. Từ mai, việc cần làm tự đến với bạn lúc
                07:30. Cần tài khoản để mở khoá dữ liệu — tạo trước hoặc tạo ngay trong ứng dụng.
              </p>
            </div>
            <div className="row">
              {downloadHref ? (
                <a href={downloadHref} download className="btn light xl">
                  {ctaLabel}
                </a>
              ) : (
                <Link to="/tai-ve" className="btn light xl">
                  {ctaLabel}
                </Link>
              )}
              <Link to="/dang-ky" className="btn outline xl">
                Tạo tài khoản
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Mũi tên tải xuống dùng cho các nút CTA ở hero. */
function DownloadGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M6 9l6 6 6-6M4 21h16" />
    </svg>
  );
}

/** Minh hoạ giao diện ứng dụng: hộp thư hợp nhất bốn nguồn + bản tin giọng nói. Dựng bằng CSS cho nhẹ. */
function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="app-window">
        <div className="win-head">
          <i />
          <i />
          <i />
          <span>Work Assistant · Hội thoại</span>
        </div>
        <div className="win-body">
          <div className="inbox">
            <div className="inbox-item active">
              <SourceIcon kind="zalo" />
              <div className="t">
                <b>Chị Lan · khách hàng</b>
                <span>Niềng trong suốt bên em giá thế nào ạ?</span>
              </div>
              <span className="badge">2</span>
            </div>
            <div className="inbox-item">
              <SourceIcon kind="telegram" />
              <div className="t">
                <b>Nhóm Marketing Q3</b>
                <span>Duyệt bài đăng tối nay nhé mọi người</span>
              </div>
            </div>
            <div className="inbox-item">
              <SourceIcon kind="email" />
              <div className="t">
                <b>Kế toán · Hoá đơn tháng 9</b>
                <span>Anh xác nhận giúp em số liệu đính kèm</span>
              </div>
              <span className="badge">1</span>
            </div>
            <div className="inbox-item">
              <SourceIcon kind="lark" />
              <div className="t">
                <b>Phiếu duyệt · Mua vật tư</b>
                <span>Đang chờ BẠN duyệt · 2 bước còn lại</span>
              </div>
            </div>
          </div>
          <div className="digest">
            <div className="digest-head">
              <SourceIcon kind="ai" />
              <div>
                <b>Bản tin 07:30 · AI cục bộ</b>
                <span>4 kênh · 7 việc cần làm</span>
              </div>
            </div>
            <ul className="digest-list">
              <li>
                <span className="k">Zalo</span>
                Chị Lan hỏi giá niềng trong suốt — gửi bảng giá, mời chụp phim tuần này.
              </li>
              <li>
                <span className="k">Email</span>
                Kế toán chờ xác nhận hoá đơn tháng 9 trước 15:00.
              </li>
              <li>
                <span className="k">Lark</span>
                1 phiếu mua vật tư đang chờ bạn duyệt.
              </li>
            </ul>
            <div className="voice">
              <span className="play">▶</span>
              <span className="wave">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="dur">Nữ miền Bắc · 1:24</span>
            </div>
          </div>
        </div>
      </div>
      <div className="hero-badge tl">
        <SourceIcon kind="voice" />
        <span>
          Bản tin giọng nói
          <small>07:30 &amp; 17:30 mỗi ngày</small>
        </span>
      </div>
      <div className="hero-badge br">
        <span className="src-ico" style={{ background: 'var(--ok)' }}>
          🔒
        </span>
        <span>
          Dữ liệu ở trên máy bạn
          <small>Máy chủ không nhận nội dung</small>
        </span>
      </div>
    </div>
  );
}
