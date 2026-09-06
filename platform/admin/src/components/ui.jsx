import { useEffect, useState } from 'react';
import { marked } from 'marked';

/** Vòng quay chờ + câu mô tả. */
export function Loading({ text = 'Đang tải…' }) {
  return (
    <div className="loading">
      <span className="spinner" style={{ verticalAlign: 'middle', marginRight: 8 }} />
      {text}
    </div>
  );
}

export function EmptyState({ icon = '📭', title, hint, action }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <b style={{ fontSize: 17 }}>{title}</b>
      {hint && <p style={{ marginTop: 6 }}>{hint}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** Hiện câu lỗi tiếng Việt do máy chủ trả về (trường `error`). */
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'Đã có lỗi xảy ra.';
  return (
    <div className="err" role="alert">
      <div className="row" style={{ gap: 10 }}>
        <span className="grow">{message}</span>
        {onRetry && (
          <button type="button" className="sm" onClick={onRetry}>
            Thử lại
          </button>
        )}
      </div>
    </div>
  );
}

export function Pagination({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 12)));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button type="button" className="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Trước
      </button>
      <span className="small muted">
        Trang {page} / {pages}
      </span>
      <button
        type="button"
        className="sm"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Sau →
      </button>
    </div>
  );
}

/** Nút sao chép, đổi nhãn 1,6 giây sau khi chép xong. */
export function CopyButton({ value, label = 'Sao chép', className = 'sm' }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value || ''));
          setDone(true);
        } catch {
          /* trình duyệt chặn clipboard — bỏ qua, người dùng bôi đen chép tay */
        }
      }}
    >
      {done ? '✓ Đã chép' : label}
    </button>
  );
}

/** Ô mật khẩu có nút hiện/ẩn. */
export function PasswordInput({ value, onChange, placeholder, autoComplete, required, minLength }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
      <button
        type="button"
        className="eye"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        title={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

/**
 * Nội dung markdown/HTML.
 * - `html`: HTML máy chủ đã render + làm sạch (sanitize-html) ⇒ hiển thị thẳng.
 * - `md`: markdown thô, dùng cho XEM TRƯỚC trong admin ⇒ render bằng marked ở trình duyệt.
 */
export function Prose({ html, md, className = '' }) {
  const content = html != null ? html : md != null ? renderMarkdown(md) : '';
  return (
    <div
      className={`prose ${className}`.trim()}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(md) {
  try {
    return marked.parse(String(md || ''));
  } catch {
    return '<p>Không hiển thị được nội dung markdown.</p>';
  }
}

/** Thanh tiến trình 0..100 dùng khi tải tệp lên. */
export function ProgressBar({ percent }) {
  return (
    <div className="progress">
      <i style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} />
    </div>
  );
}
