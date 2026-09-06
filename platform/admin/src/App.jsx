import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loading } from './components/ui.jsx';
import { useAuth } from './auth.jsx';

import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Forbidden from './pages/Forbidden.jsx';
import NotFound from './pages/NotFound.jsx';

import AdminLayout from './admin/AdminLayout.jsx';
import Dashboard from './admin/Dashboard.jsx';
import PostsAdmin from './admin/PostsAdmin.jsx';
import ReleasesAdmin from './admin/ReleasesAdmin.jsx';
import UsersAdmin from './admin/UsersAdmin.jsx';
import SiteAdmin from './admin/SiteAdmin.jsx';

/**
 * Ứng dụng quản trị — tách biệt với trang chính, phục vụ ở admin.<domain>.
 * Chỉ có đăng nhập và quên mật khẩu; KHÔNG có đăng ký (tài khoản do quản trị viên tạo hoặc đăng ký ở trang chính).
 */
export default function App() {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <Routes>
      <Route path="/dang-nhap" element={<Login />} />
      <Route path="/quen-mat-khau" element={<ForgotPassword />} />
      <Route path="/403" element={<Forbidden />} />
      <Route path="/" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
        <Route index element={<Dashboard />} />
        <Route path="bai-viet" element={<PostsAdmin />} />
        <Route path="phien-ban" element={<ReleasesAdmin />} />
        <Route path="nguoi-dung" element={<UsersAdmin />} />
        <Route path="trang-chu" element={<SiteAdmin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** Chưa đăng nhập → trang đăng nhập; đăng nhập nhưng không phải admin → 403. */
function RequireAdmin({ children }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Loading text="Đang kiểm tra quyền truy cập…" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/dang-nhap?next=${next}`} replace />;
  }
  if (!isAdmin) return <Forbidden />;
  return children;
}
