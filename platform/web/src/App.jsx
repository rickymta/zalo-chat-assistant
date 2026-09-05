import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import SiteLayout from './components/SiteLayout.jsx';
import { Loading } from './components/ui.jsx';
import { useAuth } from './auth.jsx';

import Home from './pages/Home.jsx';
import Download from './pages/Download.jsx';
import Updates from './pages/Updates.jsx';
import Posts from './pages/Posts.jsx';
import PostDetail from './pages/PostDetail.jsx';
import Guide from './pages/Guide.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Account from './pages/Account.jsx';
import NotFound from './pages/NotFound.jsx';
import Forbidden from './pages/Forbidden.jsx';

import AdminLayout from './admin/AdminLayout.jsx';
import AdminDashboard from './admin/Dashboard.jsx';
import AdminPosts from './admin/PostsAdmin.jsx';
import AdminReleases from './admin/ReleasesAdmin.jsx';
import AdminUsers from './admin/UsersAdmin.jsx';
import AdminSite from './admin/SiteAdmin.jsx';

export default function App() {
  const location = useLocation();

  // Đổi trang thì cuộn lên đầu (SPA không tự làm).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="tai-ve" element={<Download />} />
        <Route path="cap-nhat" element={<Updates />} />
        <Route path="bai-viet" element={<Posts />} />
        <Route path="bai-viet/:slug" element={<PostDetail />} />
        <Route path="huong-dan" element={<Guide />} />
        <Route path="huong-dan/:slug" element={<PostDetail backTo="/huong-dan" />} />
        <Route path="dang-nhap" element={<Login />} />
        <Route path="dang-ky" element={<Register />} />
        <Route path="quen-mat-khau" element={<ForgotPassword />} />
        <Route
          path="tai-khoan"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route path="403" element={<Forbidden />} />
        <Route path="404" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="bai-viet" element={<AdminPosts />} />
        <Route path="phien-ban" element={<AdminReleases />} />
        <Route path="nguoi-dung" element={<AdminUsers />} />
        <Route path="trang-chu" element={<AdminSite />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading text="Đang kiểm tra phiên đăng nhập…" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/dang-nhap?next=${next}`} replace />;
  }
  return children;
}

/** Khu quản trị: chưa đăng nhập → về trang đăng nhập; không phải admin → 403. */
function RequireAdmin({ children }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Loading text="Đang kiểm tra quyền truy cập…" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/dang-nhap?next=${next}`} replace />;
  }
  if (!isAdmin) return <Forbidden standalone />;
  return children;
}
