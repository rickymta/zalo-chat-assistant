import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox, PasswordInput } from '../components/ui.jsx';

/** Đăng nhập khu quản trị — không có đăng ký; quên mật khẩu dùng chung quy trình mã 8 ký tự qua email. */
export default function Login() {
  const { user, loading, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const next = params.get('next') || '/';

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Đăng nhập quản trị</h1>
          <p className="form-sub">Chỉ dành cho tài khoản quản trị viên của Zalo Chat Assistant.</p>

          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />

            <div className="fld">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="ten@meddental.vn" autoComplete="username" required autoFocus />
            </div>

            <div className="fld">
              <label htmlFor="password">Mật khẩu</label>
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" required />
            </div>

            <button type="submit" className="primary wide" disabled={busy}>
              {busy && <span className="spinner on-primary" />}
              {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>

            <div className="links">
              <Link to="/quen-mat-khau">Quên mật khẩu?</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
