import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ApiError } from '../api.js';
import { ErrorBox, PasswordInput } from '../components/ui.jsx';

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    confirm: '',
    registrationCode: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/tai-khoan" replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError(new ApiError('Mật khẩu phải có ít nhất 8 ký tự.', 400));
      return;
    }
    if (form.password !== form.confirm) {
      setError(new ApiError('Hai lần nhập mật khẩu không giống nhau.', 400));
      return;
    }
    setBusy(true);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
        registrationCode: form.registrationCode.trim() || undefined,
      });
      navigate('/tai-khoan', { replace: true });
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
          <h1>Đăng ký tài khoản</h1>
          <p className="form-sub">
            Tài khoản này dùng chung cho website và ứng dụng trên máy. Máy chủ chỉ giữ thông tin đăng
            nhập và chuỗi mã hoá — không nhận tin nhắn.
          </p>

          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />

            <div className="fld">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="ten@meddental.vn"
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div className="fld">
              <label htmlFor="name">
                Họ tên <em>(không bắt buộc)</em>
              </label>
              <input
                id="name"
                type="text"
                value={form.name}
                onChange={set('name')}
                placeholder="Nguyễn Văn A"
                autoComplete="name"
              />
            </div>

            <div className="fld">
              <label htmlFor="password">Mật khẩu</label>
              <PasswordInput
                value={form.password}
                onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <span className="help">Ít nhất 8 ký tự.</span>
            </div>

            <div className="fld">
              <label htmlFor="confirm">Nhập lại mật khẩu</label>
              <PasswordInput
                value={form.confirm}
                onChange={(v) => setForm((f) => ({ ...f, confirm: v }))}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="fld">
              <label htmlFor="code">
                Mã đăng ký <em>(nếu công ty yêu cầu)</em>
              </label>
              <input
                id="code"
                type="text"
                value={form.registrationCode}
                onChange={set('registrationCode')}
                placeholder="Nhập mã được cấp"
                autoComplete="off"
              />
              <span className="help">
                Không có mã mà hệ thống yêu cầu thì đăng ký sẽ bị từ chối — hỏi quản trị viên để được
                cấp.
              </span>
            </div>

            <button type="submit" className="primary wide" disabled={busy}>
              {busy && <span className="spinner on-primary" />}
              {busy ? 'Đang tạo tài khoản…' : 'Đăng ký'}
            </button>

            <div className="links">
              <Link to="/dang-nhap">Đã có tài khoản? Đăng nhập</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
