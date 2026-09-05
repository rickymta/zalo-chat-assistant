import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api.js';
import { ErrorBox, PasswordInput } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

/**
 * Quên mật khẩu — 2 bước:
 *  1. Nhập email  → POST /api/auth/forgot-password (luôn 200, kể cả email không tồn tại).
 *  2. Nhập mã 8 ký tự + mật khẩu mới → POST /api/auth/reset-password.
 */
export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toastOk } = useToast();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [delivery, setDelivery] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post('/api/auth/forgot-password', { email: email.trim() }, { auth: false });
      setDelivery(res && res.delivery ? res.delivery : 'email');
      setStep(2);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(new ApiError('Mật khẩu mới phải có ít nhất 8 ký tự.', 400));
      return;
    }
    if (password !== confirm) {
      setError(new ApiError('Hai lần nhập mật khẩu không giống nhau.', 400));
      return;
    }
    setBusy(true);
    try {
      await post(
        '/api/auth/reset-password',
        { email: email.trim(), code: code.trim().toUpperCase(), newPassword: password },
        { auth: false },
      );
      toastOk('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
      navigate('/dang-nhap', { replace: true });
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
          <h1>Quên mật khẩu</h1>
          <p className="form-sub">
            {step === 1
              ? 'Nhập email tài khoản, hệ thống sẽ gửi mã đặt lại gồm 8 ký tự.'
              : 'Nhập mã bạn nhận được cùng mật khẩu mới.'}
          </p>

          {step === 1 ? (
            <form className="form" onSubmit={requestCode}>
              <ErrorBox error={error} />
              <div className="fld">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ten@meddental.vn"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="primary wide" disabled={busy}>
                {busy && <span className="spinner on-primary" />}
                {busy ? 'Đang gửi…' : 'Gửi mã đặt lại'}
              </button>
              <div className="links">
                <Link to="/dang-nhap">Quay lại đăng nhập</Link>
              </div>
            </form>
          ) : (
            <form className="form" onSubmit={resetPassword}>
              <div className={delivery === 'email' ? 'notice' : 'hint'}>
                {delivery === 'email' ? (
                  <>
                    Nếu email <b>{email}</b> có trong hệ thống, mã đặt lại đã được gửi tới hộp thư đó.
                    Mã có hiệu lực 30 phút, nhập sai quá 5 lần sẽ phải xin mã mới.
                  </>
                ) : (
                  <>
                    Máy chủ chưa cấu hình gửi email, nên mã được ghi vào <b>log máy chủ</b>. Hãy liên
                    hệ quản trị viên để đọc mã cho tài khoản <b>{email}</b>.
                  </>
                )}
              </div>

              <ErrorBox error={error} />

              <div className="fld">
                <label htmlFor="code">Mã đặt lại (8 ký tự)</label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="VÍ DỤ: A1B2C3D4"
                  maxLength={8}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  style={{ letterSpacing: '2px', fontFamily: 'ui-monospace, Menlo, monospace' }}
                />
              </div>

              <div className="fld">
                <label htmlFor="new-pass">Mật khẩu mới</label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                <span className="help">Ít nhất 8 ký tự.</span>
              </div>

              <div className="fld">
                <label htmlFor="confirm-pass">Nhập lại mật khẩu mới</label>
                <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" required />
              </div>

              <button type="submit" className="primary wide" disabled={busy}>
                {busy && <span className="spinner on-primary" />}
                {busy ? 'Đang đặt lại…' : 'Đặt lại mật khẩu'}
              </button>

              <div className="warnbox small">
                Đặt lại mật khẩu sẽ <b>đăng xuất mọi thiết bị</b> đang dùng tài khoản này — kể cả ứng
                dụng trên máy. Dữ liệu đã lưu vẫn đọc được sau khi đăng nhập lại.
              </div>

              <div className="links">
                <button type="button" className="link" onClick={() => setStep(1)}>
                  ← Đổi email khác
                </button>
                <button type="button" className="link" onClick={() => requestCode()} disabled={busy}>
                  Gửi lại mã
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
