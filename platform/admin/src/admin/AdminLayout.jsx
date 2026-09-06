import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { publicSiteUrl } from '../lib/site-url.js';

const MENU = [
  { to: '/', end: true, icon: '📊', label: 'Tổng quan' },
  { to: '/bai-viet', icon: '📝', label: 'Bài viết' },
  { to: '/phien-ban', icon: '📦', label: 'Phiên bản' },
  { to: '/nguoi-dung', icon: '👥', label: 'Người dùng' },
  { to: '/trang-chu', icon: '🏠', label: 'Trang chủ' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const doLogout = async () => {
    await logout();
    navigate('/dang-nhap', { replace: true });
  };

  return (
    <div className="admin">
      <aside className="admin-side">
        <Link to="/" className="brand">
          <span className="logo" aria-hidden="true">
            Z
          </span>
          <span>
            <b>Quản trị</b>
            <span>Zalo Chat Assistant</span>
          </span>
        </Link>

        <nav>
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico" aria-hidden="true">
                {m.icon}
              </span>
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div className="side-foot">
          <div className="small" style={{ marginBottom: 10 }}>
            <b>{user ? user.name || user.email : ''}</b>
            <br />
            <span className="faint">Quản trị viên</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <a href={publicSiteUrl()} className="btn sm" target="_blank" rel="noopener">
              Xem website
            </a>
            <button type="button" className="sm" onClick={doLogout}>
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
