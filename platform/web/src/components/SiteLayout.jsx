import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { adminSiteUrl } from '../lib/site-url.js';
import { useAuth } from '../auth.jsx';
import { useSite } from '../site.jsx';
import { BRAND_NAME, BrandMark, SOURCES, SourceChip } from './Brand.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const NAV = [
  { to: '/tai-ve', label: 'Tải về' },
  { to: '/huong-dan', label: 'Hướng dẫn' },
  { to: '/cap-nhat', label: 'Cập nhật' },
  { to: '/bai-viet', label: 'Bài viết' },
];

export default function SiteLayout() {
  const location = useLocation();
  // Trang chủ có hero tràn mép nên bỏ đệm trên của khung chính.
  const flush = location.pathname === '/';
  return (
    <div className="page">
      <Header />
      <main className={`site-main${flush ? ' flush' : ''}`}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const { site } = useSite();
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Đổi trang thì đóng menu điện thoại.
  useEffect(() => setOpen(false), [location.pathname]);

  // Rời trang cần đăng nhập TRƯỚC khi xoá phiên, nếu không RequireAuth sẽ đá sang
  // trang đăng nhập ngay lúc trạng thái đổi.
  const doLogout = async () => {
    navigate('/', { replace: true });
    await logout();
  };

  const appName = site.appName || BRAND_NAME;

  return (
    <header className="site-header">
      <div className="wrap">
        <div className="bar">
          <Link to="/" className="brand" aria-label={`${appName} — trang chủ`}>
            <BrandMark size={38} />
            <span>
              <b>{appName}</b>
              <span>{site.tagline}</span>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Điều hướng chính">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            <ThemeToggle />
            {isAdmin && (
              <a href={adminSiteUrl()} className="btn sm hide-sm">
                Quản trị
              </a>
            )}
            {user ? (
              <>
                <Link to="/tai-khoan" className="btn sm hide-sm">
                  {user.name || user.email}
                </Link>
                <button type="button" className="sm ghost hide-sm" onClick={doLogout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <>
                <Link to="/dang-nhap" className="btn sm ghost hide-sm">
                  Đăng nhập
                </Link>
                <Link to="/tai-ve" className="btn sm primary">
                  Tải ứng dụng
                </Link>
              </>
            )}
            <button
              type="button"
              className="burger"
              aria-label={open ? 'Đóng menu' : 'Mở menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '✕' : '☰'}
            </button>
          </div>
        </div>

        <nav className={`mobile-nav${open ? ' open' : ''}`} aria-label="Điều hướng điện thoại">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
          <div className="sep" />
          {user ? (
            <>
              <NavLink to="/tai-khoan">Tài khoản · {user.name || user.email}</NavLink>
              {isAdmin && <a href={adminSiteUrl()}>Khu quản trị</a>}
              <button type="button" className="ghost" onClick={doLogout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <NavLink to="/dang-nhap">Đăng nhập</NavLink>
              <NavLink to="/dang-ky">Đăng ký tài khoản</NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { site } = useSite();
  const { user } = useAuth();
  const contact = site.contact || {};
  const year = new Date().getFullYear();
  const appName = site.appName || BRAND_NAME;
  const hasContact = contact.email || contact.phone || contact.zalo || contact.address;

  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="brand">
              <BrandMark size={34} />
              <span>
                <b>{appName}</b>
                <span>{site.tagline}</span>
              </span>
            </Link>
            <p>
              Gom Zalo, Telegram, Email và Lark Approval về một chỗ trên máy bạn; AI cục bộ tóm tắt và
              đọc thành bản tin giọng nói. Máy chủ chỉ giữ tài khoản — nội dung không bao giờ rời khỏi
              máy.
            </p>
            <div className="footer-sources">
              {SOURCES.map((s) => (
                <SourceChip key={s.key} kind={s.key} label={s.label} />
              ))}
            </div>
          </div>
          <div>
            <h4>Sản phẩm</h4>
            <ul>
              <li>
                <Link to="/tai-ve">Tải ứng dụng</Link>
              </li>
              <li>
                <Link to="/cap-nhat">Lịch sử phiên bản</Link>
              </li>
              <li>
                <Link to="/huong-dan">Hướng dẫn sử dụng</Link>
              </li>
              <li>
                <Link to="/bai-viet">Bài viết</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4>Tài khoản</h4>
            <ul>
              {user ? (
                <li>
                  <Link to="/tai-khoan">Tài khoản của tôi</Link>
                </li>
              ) : (
                <>
                  <li>
                    <Link to="/dang-nhap">Đăng nhập</Link>
                  </li>
                  <li>
                    <Link to="/dang-ky">Đăng ký</Link>
                  </li>
                </>
              )}
              <li>
                <Link to="/quen-mat-khau">Quên mật khẩu</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4>Liên hệ</h4>
            <ul>
              {contact.email && (
                <li>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </li>
              )}
              {contact.phone && (
                <li>
                  <a href={`tel:${String(contact.phone).replace(/\s/g, '')}`}>{contact.phone}</a>
                </li>
              )}
              {contact.zalo && <li>Zalo: {contact.zalo}</li>}
              {contact.address && <li>{contact.address}</li>}
              {!hasContact && <li className="faint">Cần hỗ trợ? Liên hệ quản trị viên hệ thống.</li>}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {year} {appName} — MedDental. Dùng nội bộ.
          </span>
          <span>macOS (Apple Silicon &amp; Intel) · Windows 64-bit</span>
        </div>
      </div>
    </footer>
  );
}
