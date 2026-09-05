import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const MENU = [
  { to: '/admin', end: true, icon: '📊', label: 'Tổng quan' },
  { to: '/admin/bai-viet', icon: '📝', label: 'Bài viết' },
  { to: '/admin/phien-ban', icon: '📦', label: 'Phiên bản' },
  { to: '/admin/nguoi-dung', icon: '👥', label: 'Người dùng' },
  { to: '/admin/trang-chu', icon: '🏠', label: 'Trang chủ' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Rời khu quản trị TRƯỚC khi xoá phiên — nếu xoá trước, chốt chặn quyền kịp đá sang
  // trang đăng nhập và người dùng không bao giờ thấy trang chủ.
  const doLogout = async () => {
    navigate('/', { replace: true });
    await logout();
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
            <Link to="/" className="btn sm">
              Xem website
            </Link>
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
