import { useEffect, useState } from 'react';
import { patch, post, qs } from '../api.js';
import { useFetch } from '../lib/useFetch.js';
import { useAuth } from '../auth.jsx';
import { Modal, useConfirm } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { CopyButton, EmptyState, ErrorBox, Loading, Pagination } from '../components/ui.jsx';
import { formatDate, formatDateTime, timeAgo } from '../lib/format.js';

const LIMIT = 20;

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [resetInfo, setResetInfo] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Gõ xong 400 ms mới gọi máy chủ (đỡ mỗi phím một request).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const { data, loading, error, reload } = useFetch(
    `/api/admin/users${qs({ q: search, page, limit: LIMIT })}`,
    { deps: [search, page] },
  );

  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;

  const changeRole = async (u, role) => {
    if (u.role === role) return;
    const ok = await confirm({
      title: role === 'admin' ? 'Cấp quyền quản trị?' : 'Hạ về người dùng thường?',
      message:
        role === 'admin'
          ? `${u.email} sẽ vào được toàn bộ khu quản trị: bài viết, phiên bản, người dùng, cấu hình trang chủ.`
          : `${u.email} sẽ không vào được khu quản trị nữa.`,
      confirmText: 'Đổi vai trò',
      danger: role !== 'admin',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await patch(`/api/admin/users/${encodeURIComponent(u.id)}`, { role });
      toastOk('Đã đổi vai trò.');
      reload();
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleDisabled = async (u) => {
    const disabling = !u.disabled;
    const ok = await confirm({
      title: disabling ? 'Khoá tài khoản?' : 'Mở khoá tài khoản?',
      message: disabling
        ? `${u.email} sẽ không đăng nhập được nữa (cả website lẫn ứng dụng).`
        : `${u.email} sẽ đăng nhập lại được bình thường.`,
      detail: disabling
        ? 'Ứng dụng trên máy người đó sẽ báo tài khoản bị khoá ở lần làm mới phiên kế tiếp. Dữ liệu đã lưu trên máy họ không bị xoá.'
        : null,
      confirmText: disabling ? 'Khoá tài khoản' : 'Mở khoá',
      danger: disabling,
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await patch(`/api/admin/users/${encodeURIComponent(u.id)}`, { disabled: disabling });
      toastOk(disabling ? 'Đã khoá tài khoản.' : 'Đã mở khoá tài khoản.');
      reload();
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const makeResetCode = async (u) => {
    const ok = await confirm({
      title: 'Tạo mã đặt lại mật khẩu?',
      message: `Hệ thống sinh mã 8 ký tự cho ${u.email}. Bạn đọc mã đó cho người dùng để họ tự đặt mật khẩu mới.`,
      detail: 'Dùng khi máy chủ chưa cấu hình gửi email. Mã có hạn dùng ngắn, chỉ đọc cho đúng người.',
      confirmText: 'Tạo mã',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      const res = await post(`/api/admin/users/${encodeURIComponent(u.id)}/reset-code`);
      setResetInfo({ user: u, ...res });
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Người dùng</h1>
          <p>Tài khoản dùng chung cho website và ứng dụng trên máy.</p>
        </div>
        <span className="pill">{total} tài khoản</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Tìm theo email hoặc tên…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="grow" />
        <button type="button" onClick={reload}>
          ↻ Làm mới
        </button>
      </div>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải danh sách người dùng…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="👥"
          title={search ? 'Không tìm thấy tài khoản nào' : 'Chưa có tài khoản nào'}
          hint={search ? 'Thử từ khoá khác.' : null}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Chuỗi mã hoá</th>
                  <th>Đăng nhập gần nhất</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.name || <span className="faint">Chưa đặt tên</span>}</b>
                      {me && me.id === u.id && <span className="pill info" style={{ marginLeft: 8 }}>Bạn</span>}
                      <br />
                      <span className="small muted">{u.email}</span>
                      <br />
                      <span className="small faint">Tạo {formatDate(u.createdAt)}</span>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => changeRole(u, e.target.value)}
                        style={{ width: 'auto', minWidth: 150 }}
                      >
                        <option value="user">Người dùng</option>
                        <option value="admin">Quản trị viên</option>
                      </select>
                    </td>
                    <td>
                      {u.disabled ? (
                        <span className="pill bad">Đã khoá</span>
                      ) : (
                        <span className="pill ok">Hoạt động</span>
                      )}
                    </td>
                    <td>
                      {u.keyVersion ? `Phiên bản ${u.keyVersion}` : <span className="faint">—</span>}
                      {typeof u.sessions === 'number' && (
                        <>
                          <br />
                          <span className="small faint">{u.sessions} phiên đang mở</span>
                        </>
                      )}
                    </td>
                    <td>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : <span className="faint">Chưa đăng nhập</span>}</td>
                    <td className="actions">
                      <button
                        type="button"
                        className="sm"
                        onClick={() => makeResetCode(u)}
                        disabled={busyId === u.id}
                      >
                        Mã đặt lại
                      </button>
                      <button
                        type="button"
                        className={`sm${u.disabled ? '' : ' danger'}`}
                        onClick={() => toggleDisabled(u)}
                        disabled={busyId === u.id}
                      >
                        {u.disabled ? 'Mở khoá' : 'Khoá'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
        </>
      )}

      <Modal
        open={!!resetInfo}
        title="Mã đặt lại mật khẩu"
        onClose={() => setResetInfo(null)}
        footer={
          <button type="button" className="primary" onClick={() => setResetInfo(null)}>
            Đã đọc xong
          </button>
        }
      >
        {resetInfo && (
          <div className="col">
            <p>
              Mã dành cho <b>{resetInfo.user.email}</b>. Đọc mã này cho người dùng, họ vào trang{' '}
              <b>Quên mật khẩu</b> nhập email + mã để đặt mật khẩu mới.
            </p>
            <div
              className="card tight center"
              style={{ background: 'var(--primary-soft)', borderColor: '#c7dbff' }}
            >
              <div
                className="mono"
                style={{ fontSize: 30, fontWeight: 800, letterSpacing: 5, color: 'var(--primary)' }}
              >
                {resetInfo.code}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <CopyButton value={resetInfo.code} label="Sao chép mã" className="" />
            </div>
            {resetInfo.expiresAt && (
              <p className="small muted center">Mã hết hạn lúc {formatDateTime(resetInfo.expiresAt)}.</p>
            )}
            <div className="warnbox">
              Đặt lại mật khẩu sẽ thu hồi mọi phiên đăng nhập của tài khoản đó — người dùng phải đăng
              nhập lại trên ứng dụng.
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
