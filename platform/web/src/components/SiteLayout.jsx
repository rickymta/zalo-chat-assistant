import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { adminSiteUrl } from '../lib/site-url.js';
import { useAuth } from '../auth.jsx';
import { useSite } from '../site.jsx';

const NAV = [
  { to: '/tai-ve', label: 'Tải về' },
  { to: '/huong-dan', label: 'Hướng dẫn' },
  { to: '/cap-nhat', label: 'Cập nhật' },
  { to: '/bai-viet', label: 'Bài viết' },
];

export default function SiteLayout() {
  return (
    <div className="page">
      <Header />
      <main className="site-main">
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

  return (
    <header className="site-header">
      <div className="wrap">
        <div className="bar">
          <Link to="/" className="brand">
            <span className="logo" aria-hidden="true">
              Z
            </span>
            <span>
              <b>{site.appName || 'Zalo Chat Assistant'}</b>
              <span>{site.tagline}</span>
            </span>
          </Link>

          <nav className="site-nav">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            {isAdmin && (
              <a href={adminSiteUrl()} className="btn sm">
                Quản trị
              </a>
            )}
            {user ? (
              <>
                <Link to="/tai-khoan" className="btn sm">
                  {user.name || user.email}
                </Link>
                <button type="button" className="sm" onClick={doLogout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <>
                <Link to="/dang-nhap" className="btn sm">
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
              aria-label="Mở menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              ☰
            </button>
          </div>
        </div>

        <nav className={`mobile-nav${open ? ' open' : ''}`}>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
          {user ? (
            <>
              <NavLink to="/tai-khoan">Tài khoản</NavLink>
              {isAdmin && <a href={adminSiteUrl()}>Quản trị</a>}
              <button type="button" className="ghost" style={{ justifyContent: 'flex-start' }} onClick={doLogout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <NavLink to="/dang-nhap">Đăng nhập</NavLink>
              <NavLink to="/dang-ky">Đăng ký</NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { site } = useSite();
  const contact = site.contact || {};
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <h4>{site.appName || 'Zalo Chat Assistant'}</h4>
            <p>
              {site.tagline ||
                'Lưu hội thoại Zalo vào máy ở dạng mã hoá, để Claude Cowork tổng hợp và đề xuất câu trả lời.'}
            </p>
            <p className="small faint" style={{ marginTop: 10 }}>
              Máy chủ không bao giờ nhận nội dung tin nhắn — dữ liệu nằm trên máy của bạn.
            </p>
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
              {!contact.email && !contact.phone && !contact.zalo && !contact.address && (
                <li className="faint">Chưa cấu hình thông tin liên hệ.</li>
              )}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {year} {site.appName || 'Zalo Chat Assistant'} — MedDental. Dùng nội bộ.
          </span>
          <span>Cần hỗ trợ? Liên hệ quản trị viên hệ thống.</span>
        </div>
      </div>
    </footer>
  );
}
