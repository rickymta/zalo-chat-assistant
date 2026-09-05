import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/**
 * 403 — dùng cho cả trang công khai lẫn chốt chặn khu quản trị.
 * `standalone` = dựng full màn hình (khu /admin không có header/footer của trang công khai).
 */
export default function Forbidden({ standalone = false }) {
  const { user, logout } = useAuth();

  const content = (
    <div className="status-page">
      <div>
        <div className="code">403</div>
        <h1>Bạn không có quyền vào khu vực này</h1>
        <p>
          Khu quản trị chỉ dành cho tài khoản có vai trò <b>quản trị viên</b>.
          {user ? (
            <>
              {' '}
              Bạn đang đăng nhập bằng <b>{user.email}</b> (vai trò: {roleLabel(user.role)}). Nếu cần
              quyền quản trị, liên hệ quản trị viên hệ thống để được cấp.
            </>
          ) : (
            ' Hãy đăng nhập bằng tài khoản quản trị.'
          )}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn primary">
            Về trang chủ
          </Link>
          {user ? (
            <>
              <Link to="/tai-khoan" className="btn">
                Tài khoản của tôi
              </Link>
              <button type="button" onClick={logout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <Link to="/dang-nhap" className="btn">
              Đăng nhập
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  if (!standalone) return <div className="wrap">{content}</div>;
  return (
    <div className="page">
      <div className="wrap" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        {content}
      </div>
    </div>
  );
}

function roleLabel(role) {
  return role === 'admin' ? 'quản trị viên' : 'người dùng';
}
