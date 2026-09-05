import { formatBytes, formatDate, channelLabel } from '../lib/format.js';

const ICONS = { darwin: '🍎', win32: '🪟', linux: '🐧' };

/** Thẻ một bản tải theo hệ điều hành (dùng ở trang chủ và trang Tải về). */
export function TargetCard({ target, release, highlight = false }) {
  const icon = ICONS[target.platform] || '💻';
  return (
    <div className={`dl-card${highlight ? ' primary-target' : ''}`}>
      <div className="os">
        <span className="ico" aria-hidden="true">
          {icon}
        </span>
        {target.label}
        {highlight && <span className="pill info">Máy của bạn</span>}
      </div>

      {release ? (
        <>
          <div className="meta">
            <span>
              Phiên bản <b>{release.version}</b>
            </span>
            <span>{formatBytes(release.fileSize)}</span>
            <span>{formatDate(release.publishedAt)}</span>
            {release.channel === 'beta' && <span className="pill warn">{channelLabel(release.channel)}</span>}
          </div>
          <a className="btn primary" href={release.downloadUrl} download>
            Tải {target.ext === '.exe' ? 'bản .exe' : 'bản .dmg'}
          </a>
        </>
      ) : (
        <>
          <div className="meta">Chưa có bản phát hành cho nền tảng này.</div>
          <button type="button" disabled>
            Chưa có bản tải
          </button>
        </>
      )}
    </div>
  );
}
