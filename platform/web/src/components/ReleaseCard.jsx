import { formatBytes, formatDate, channelLabel } from '../lib/format.js';
import { OsIcon } from './Brand.jsx';

const SUB = {
  'darwin-arm64': 'Apple Silicon (M1/M2/M3…) · .dmg',
  'darwin-x64': 'Chip Intel · .dmg',
  'win32-x64': 'Windows 10/11 · .exe',
};

/** Thẻ một bản tải theo hệ điều hành (dùng ở trang chủ và trang Tải về). */
export function TargetCard({ target, release, highlight = false }) {
  return (
    <div className={`dl-card${highlight ? ' primary-target' : ''}`}>
      {highlight && <span className="pill info mine">Máy của bạn</span>}
      <div className="os">
        <span className="os-ico">
          <OsIcon platform={target.platform} />
        </span>
        <span>
          {target.label}
          <small>{SUB[target.key] || target.ext}</small>
        </span>
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
