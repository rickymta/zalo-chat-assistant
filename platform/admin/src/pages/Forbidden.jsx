import { useAuth } from '../auth.jsx';
import { publicSiteUrl } from '../lib/site-url.js';

/** 403 — đã đăng nhập nhưng không phải quản trị viên. */
export default function Forbidden() {
  const { user, logout } = useAuth();
  return (
    <div className="page">
      <div className="wrap" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="status-page">
          <div>
            <div className="code">403</div>
            <h1>Bạn không có quyền vào khu quản trị</h1>
            <p>
              Khu này chỉ dành cho tài khoản có vai trò <b>quản trị viên</b>.
              {user ? (
                <> Bạn đang đăng nhập bằng <b>{user.email}</b>. Nếu cần quyền quản trị, liên hệ quản trị viên hệ thống để được cấp.</>
              ) : ' Hãy đăng nhập bằng tài khoản quản trị.'}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <a href={publicSiteUrl()} className="btn primary">Về trang chính</a>
              {user && <button type="button" onClick={logout}>Đăng xuất</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
