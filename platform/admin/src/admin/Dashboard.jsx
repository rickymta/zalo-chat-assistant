import { Link } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import { formatNumber, timeAgo } from '../lib/format.js';

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/api/admin/stats');

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Tổng quan</h1>
          <p>Số liệu nhanh về người dùng, phiên bản và nội dung.</p>
        </div>
        <button type="button" onClick={reload}>
          ↻ Làm mới
        </button>
      </div>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải số liệu…" />
      ) : !data ? null : (
        <div className="stack">
          <div className="tiles">
            <Tile value={data.users} label="Người dùng" sub={data.usersNew7d ? `+${formatNumber(data.usersNew7d)} trong 7 ngày` : null} />
            <Tile value={data.releases} label="Bản phát hành" />
            <Tile
              value={data.downloadsTotal}
              label="Lượt tải"
              sub={data.downloads7d ? `+${formatNumber(data.downloads7d)} trong 7 ngày` : null}
            />
            <Tile value={data.posts} label="Bài viết" />
          </div>

          <div className="card">
            <h2>Đăng nhập gần đây</h2>
            <p className="desc">Những tài khoản mở ứng dụng hoặc website gần nhất.</p>
            {!data.lastLogins || data.lastLogins.length === 0 ? (
              <EmptyState icon="🕰️" title="Chưa có lượt đăng nhập nào" />
            ) : (
              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Người dùng</th>
                      <th>Email</th>
                      <th>Vai trò</th>
                      <th>Đăng nhập</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lastLogins.map((u) => (
                      <tr key={u.id || u.email}>
                        <td>{u.name || <span className="faint">Chưa đặt tên</span>}</td>
                        <td>{u.email}</td>
                        <td>
                          {u.role === 'admin' ? (
                            <span className="pill info">Quản trị viên</span>
                          ) : (
                            <span className="pill">Người dùng</span>
                          )}
                        </td>
                        <td>{timeAgo(u.lastLoginAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Lối tắt</h2>
            <div className="row" style={{ marginTop: 12 }}>
              <Link to="/phien-ban" className="btn primary">
                📦 Đăng bản phát hành mới
              </Link>
              <Link to="/bai-viet" className="btn">
                📝 Viết bài mới
              </Link>
              <Link to="/trang-chu" className="btn">
                🏠 Sửa nội dung trang chủ
              </Link>
              <Link to="/nguoi-dung" className="btn">
                👥 Quản lý người dùng
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ value, label, sub }) {
  return (
    <div className="tile">
      <div className="v">{formatNumber(value)}</div>
      <div className="l">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
