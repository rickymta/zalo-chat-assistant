import { useState } from 'react';
import { ApiError, del, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useConfirm } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { CopyButton, ErrorBox, Loading, PasswordInput } from '../components/ui.jsx';
import { formatDate, formatDateTime, timeAgo } from '../lib/format.js';

export default function Account() {
  const { user, isAdmin } = useAuth();

  return (
    <div className="wrap">
      <div className="stack">
        <div>
          <h1>Tài khoản của tôi</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Thông tin đăng nhập, các phiên đang mở và chuỗi mã hoá dữ liệu.
          </p>
        </div>

        <ProfileCard user={user} isAdmin={isAdmin} />
        <ChangePasswordCard />
        <SessionsCard />
        <KeysCard />
      </div>
    </div>
  );
}

function ProfileCard({ user, isAdmin }) {
  if (!user) return null;
  return (
    <div className="card">
      <h2>Hồ sơ</h2>
      <p className="desc">Thông tin này dùng chung cho website và ứng dụng trên máy.</p>
      <div className="kv">
        <div>Email</div>
        <div>
          <b>{user.email}</b>
        </div>
        <div>Họ tên</div>
        <div>{user.name || <span className="faint">Chưa đặt</span>}</div>
        <div>Vai trò</div>
        <div>
          {isAdmin ? <span className="pill info">Quản trị viên</span> : <span className="pill">Người dùng</span>}
        </div>
        <div>Ngày tạo</div>
        <div>{formatDate(user.createdAt)}</div>
        <div>Đăng nhập gần nhất</div>
        <div>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</div>
      </div>
      <p className="small faint" style={{ marginTop: 14 }}>
        Cần đổi email hoặc họ tên? Liên hệ quản trị viên hệ thống.
      </p>
    </div>
  );
}

function ChangePasswordCard() {
  const { toastOk } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError(new ApiError('Mật khẩu mới phải có ít nhất 8 ký tự.', 400));
      return;
    }
    if (next !== confirmPw) {
      setError(new ApiError('Hai lần nhập mật khẩu mới không giống nhau.', 400));
      return;
    }
    setBusy(true);
    try {
      await post('/api/me/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirmPw('');
      toastOk('Đã đổi mật khẩu.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Đổi mật khẩu</h2>
      <p className="desc">Mật khẩu mới áp dụng cho cả website và ứng dụng trên máy.</p>
      <form className="form" onSubmit={submit} style={{ maxWidth: 460 }}>
        <ErrorBox error={error} />
        <div className="fld">
          <label htmlFor="cur">Mật khẩu hiện tại</label>
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" required />
        </div>
        <div className="fld">
          <label htmlFor="new">Mật khẩu mới</label>
          <PasswordInput value={next} onChange={setNext} autoComplete="new-password" required minLength={8} />
          <span className="help">Ít nhất 8 ký tự.</span>
        </div>
        <div className="fld">
          <label htmlFor="cf">Nhập lại mật khẩu mới</label>
          <PasswordInput value={confirmPw} onChange={setConfirmPw} autoComplete="new-password" required />
        </div>
        <div>
          <button type="submit" className="primary" disabled={busy}>
            {busy && <span className="spinner on-primary" />}
            {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SessionsCard() {
  const { data, loading, error, reload } = useFetch('/api/me/sessions');
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const [removing, setRemoving] = useState(null);

  const items = (data && data.items) || [];

  const revoke = async (session) => {
    const ok = await confirm({
      title: 'Đăng xuất phiên này?',
      message: `Thiết bị “${session.device || 'Không rõ'}” sẽ bị đăng xuất và phải đăng nhập lại.`,
      detail:
        'Nếu đây là ứng dụng trên máy của bạn, ứng dụng sẽ báo “Hết phiên — cần đăng nhập lại”. Dữ liệu đã lưu trên máy vẫn còn, đăng nhập lại là đọc được.',
      confirmText: 'Đăng xuất phiên',
      danger: true,
    });
    if (!ok) return;
    setRemoving(session.id);
    try {
      await del(`/api/me/sessions/${encodeURIComponent(session.id)}`);
      toastOk('Đã đăng xuất phiên đó.');
      reload();
    } catch (err) {
      toastError(err.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="card">
      <h2>Phiên đăng nhập</h2>
      <p className="desc">
        Các thiết bị đang đăng nhập tài khoản này (website và ứng dụng trên máy). Thấy thiết bị lạ thì
        đăng xuất ngay và đổi mật khẩu.
      </p>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải danh sách phiên…" />
      ) : items.length === 0 ? (
        <p className="muted">Không có phiên nào đang mở.</p>
      ) : (
        <div>
          {items.map((s) => (
            <div className="session-row" key={s.id}>
              <div className="who">
                <b>
                  {s.device || 'Thiết bị không rõ'}{' '}
                  {s.current && <span className="pill ok">Phiên hiện tại</span>}
                </b>
                <span className="small muted">
                  Đăng nhập {timeAgo(s.createdAt)} · hết hạn {formatDate(s.expiresAt)}
                </span>
              </div>
              <button
                type="button"
                className="sm danger"
                onClick={() => revoke(s)}
                disabled={removing === s.id}
              >
                {removing === s.id ? 'Đang đăng xuất…' : 'Đăng xuất'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KeysCard() {
  const { data, loading, error, reload } = useFetch('/api/keys');
  const { setKeyVersion } = useAuth();
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const [rotating, setRotating] = useState(false);
  const [revealed, setRevealed] = useState({});

  const current = data && data.current;
  const versions = (data && data.versions) || [];

  const rotate = async () => {
    const ok = await confirm({
      title: 'Đổi chuỗi mã hoá?',
      message:
        'Máy chủ sẽ cấp một chuỗi mã hoá phiên bản mới cho tài khoản của bạn.',
      detail:
        'Ứng dụng trên máy sẽ MÃ HOÁ LẠI toàn bộ tin nhắn đã lưu theo chuỗi mới (chạy nền theo lô, có thể mất vài phút với dữ liệu lớn). Trong lúc đó hãy để ứng dụng chạy, đừng tắt máy. Các máy khác cùng tài khoản tự nhận chuỗi mới khi mở lại. Chuỗi cũ vẫn được giữ để đọc dữ liệu chưa kịp mã hoá lại.',
      confirmText: 'Đổi chuỗi mã hoá',
      danger: true,
    });
    if (!ok) return;
    setRotating(true);
    try {
      const res = await post('/api/keys/rotate');
      if (res && res.current) {
        setKeyVersion(res.current.version);
        toastOk(`Đã đổi sang chuỗi mã hoá phiên bản ${res.current.version}.`);
      }
      reload();
    } catch (err) {
      toastError(err.message);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="card">
      <h2>Chuỗi mã hoá dữ liệu</h2>
      <p className="desc">
        Tin nhắn trên máy bạn được mã hoá bằng khoá dẫn xuất từ chuỗi này. Máy chủ giữ chuỗi để các máy
        cùng tài khoản đọc được dữ liệu — <b>nội dung tin nhắn không bao giờ rời khỏi máy bạn</b>.
      </p>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải thông tin chuỗi mã hoá…" />
      ) : (
        <>
          <div className="kv">
            <div>Phiên bản đang dùng</div>
            <div>
              {current ? (
                <b>Phiên bản {current.version}</b>
              ) : (
                <span className="faint">Chưa có chuỗi nào</span>
              )}
            </div>
            <div>Số phiên bản đã cấp</div>
            <div>{versions.length}</div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="danger" onClick={rotate} disabled={rotating}>
              {rotating && <span className="spinner" />}
              {rotating ? 'Đang đổi…' : '🔑 Đổi chuỗi mã hoá'}
            </button>
          </div>

          <div className="warnbox" style={{ marginTop: 14 }}>
            <b>Đổi chuỗi thì ứng dụng trên máy sẽ mã hoá lại toàn bộ dữ liệu đã lưu.</b> Việc này chạy
            nền theo lô và tiếp tục được nếu bị ngắt giữa chừng. Chỉ đổi khi nghi ngờ chuỗi đã bị lộ.
          </div>

          {versions.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)' }}>
                Xem các phiên bản chuỗi ({versions.length})
              </summary>
              <div style={{ marginTop: 10 }}>
                {versions.map((v) => (
                  <div className="session-row" key={v.version}>
                    <div className="who">
                      <b>
                        Phiên bản {v.version}{' '}
                        {current && v.version === current.version && (
                          <span className="pill ok">Đang dùng</span>
                        )}
                      </b>
                      <span className="small muted">
                        Cấp {formatDateTime(v.createdAt)} ·{' '}
                        {v.source === 'client' ? 'do máy người dùng đặt' : 'do máy chủ sinh'}
                      </span>
                      {revealed[v.version] && (
                        <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                          {v.key}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="sm"
                      onClick={() =>
                        setRevealed((r) => ({ ...r, [v.version]: !r[v.version] }))
                      }
                    >
                      {revealed[v.version] ? 'Ẩn chuỗi' : 'Hiện chuỗi'}
                    </button>
                    {revealed[v.version] && <CopyButton value={v.key} />}
                  </div>
                ))}
                <p className="small faint" style={{ marginTop: 10 }}>
                  Ai có chuỗi này là giải mã được dữ liệu trên máy bạn — đừng gửi cho người khác.
                </p>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
