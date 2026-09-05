import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="wrap">
      <div className="status-page">
        <div>
          <div className="code">404</div>
          <h1>Không tìm thấy trang này</h1>
          <p>
            Đường dẫn bạn mở không tồn tại hoặc nội dung đã được gỡ. Kiểm tra lại liên kết, hoặc quay
            về trang chủ.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/" className="btn primary">
              Về trang chủ
            </Link>
            <Link to="/tai-ve" className="btn">
              Tải ứng dụng
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
