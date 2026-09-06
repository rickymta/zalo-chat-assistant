import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="status-page">
      <div>
        <div className="code">404</div>
        <h1>Không tìm thấy trang này</h1>
        <p>Đường dẫn không tồn tại trong khu quản trị.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn primary">Về tổng quan</Link>
        </div>
      </div>
    </div>
  );
}
