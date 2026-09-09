import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useSite } from '../site.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';
import { TARGETS, detectTarget, targetLabel } from '../lib/platform.js';
import { channelLabel, formatBytes, formatDate } from '../lib/format.js';
import { CopyButton, ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { TargetCard } from '../components/ReleaseCard.jsx';
import { BRAND_NAME, OsIcon } from '../components/Brand.jsx';

const QUARANTINE_CMD = `xattr -dr com.apple.quarantine "/Applications/${BRAND_NAME}.app"`;

export default function Download() {
  usePageTitle('Tải về');
  const { site } = useSite();
  const [target, setTarget] = useState(null);
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detected = await detectTarget();
      if (cancelled) return;
      setTarget(detected);
      if (!detected.supported) {
        setLoading(false);
        return;
      }
      try {
        const params = new URLSearchParams({ platform: detected.platform, channel: 'stable' });
        if (detected.arch) params.set('arch', detected.arch);
        const data = await get(`/api/releases/latest?${params}`, { auth: false });
        if (!cancelled) setRelease(data && data.release ? data.release : null);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = site.latest || {};
  const appName = site.appName || BRAND_NAME;

  return (
    <div className="wrap">
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Tải {appName}</h1>
            <p>
              Ứng dụng chạy trên máy tính của bạn (macOS hoặc Windows). Cài xong, đăng nhập tài khoản
              rồi kết nối nguồn ở màn <b>Kết nối</b> là dùng được.
            </p>
          </div>
        </div>

        {loading ? (
          <Loading text="Đang nhận diện máy của bạn…" />
        ) : (
          <>
            <ErrorBox error={error} />
            <MainDownload target={target} release={release} appName={appName} />
          </>
        )}

        <section>
          <div className="section-head split" style={{ marginBottom: 18 }}>
            <div>
              <h2>Mọi nền tảng</h2>
              <p>Cài cho máy khác, hoặc nếu nhận diện tự động chưa đúng.</p>
            </div>
            <Link to="/cap-nhat" className="btn sm">
              Lịch sử phiên bản
            </Link>
          </div>
          <div className="dl-grid">
            {TARGETS.map((t) => (
              <TargetCard
                key={t.key}
                target={t}
                release={latest[t.key] || null}
                highlight={!!target && target.key === t.key}
              />
            ))}
          </div>
        </section>

        <InstallNotes platform={target ? target.platform : null} appName={appName} />
      </div>
    </div>
  );
}

function MainDownload({ target, release, appName }) {
  if (target && !target.supported) {
    return (
      <div className="hero-download">
        <div className="full warnbox">
          <b>Máy bạn đang dùng không cài được ứng dụng.</b>
          <p style={{ marginTop: 6 }}>
            {appName} là ứng dụng cho máy tính (macOS hoặc Windows). Bạn đang mở trang này trên{' '}
            {target.label || 'thiết bị di động'}. Hãy mở lại trang này trên máy tính, hoặc chọn bản cài
            bên dưới rồi chép sang máy tính.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hero-download">
      <div>
        <div className="target-line">
          <span className="pill info">Máy của bạn</span>
          {target && !target.confident && (
            <span className="small faint">
              nhận diện tự động — nếu không đúng, chọn bản khác ở danh sách bên dưới
            </span>
          )}
        </div>
        <div className="big-os">
          <span className="os-ico">
            <OsIcon platform={target ? target.platform : 'darwin'} />
          </span>
          <div>
            <h2>{target ? target.label : 'Không rõ'}</h2>
            <div className="ver">
              {release ? (
                <>
                  Phiên bản <b>{release.version}</b> · {formatBytes(release.fileSize)} · phát hành{' '}
                  {formatDate(release.publishedAt)}
                  {release.channel === 'beta' ? ` · kênh ${channelLabel(release.channel)}` : ''}
                </>
              ) : (
                'Chưa có bản phát hành cho cấu hình này'
              )}
            </div>
          </div>
        </div>
      </div>

      {release ? (
        <div className="dl-side">
          <a className="btn primary xl" href={release.downloadUrl} download>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M6 9l6 6 6-6M4 21h16" />
            </svg>
            Tải bản {release.version}
          </a>
          <span className="small faint">{release.fileName}</span>
        </div>
      ) : (
        <div className="dl-side">
          <button type="button" className="xl" disabled>
            Chưa có bản tải
          </button>
        </div>
      )}

      {release ? (
        <div className="full stack" style={{ gap: 16 }}>
          {release.mandatory && (
            <div className="warnbox">
              <b>Bản cập nhật bắt buộc.</b> Các bản cũ hơn cần cập nhật để tiếp tục dùng.
            </div>
          )}

          <div className="kv">
            <div>Phiên bản</div>
            <div>
              <b>{release.version}</b>{' '}
              <span className="pill">{targetLabel(release.platform, release.arch)}</span>
            </div>
            <div>Kích thước</div>
            <div>{formatBytes(release.fileSize)}</div>
            <div>Ngày phát hành</div>
            <div>{formatDate(release.publishedAt)}</div>
            {release.sha256 && (
              <>
                <div>SHA-256</div>
                <div className="sha">
                  <code>{release.sha256}</code>
                  <CopyButton value={release.sha256} />
                </div>
              </>
            )}
          </div>

          {release.notesHtml && (
            <details className="disclosure">
              <summary>Có gì mới trong bản {release.version}</summary>
              <div>
                <Prose html={release.notesHtml} />
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="full warnbox">
          <b>Chưa có bản phát hành cho {target ? target.label : 'nền tảng này'}.</b>
          <p style={{ marginTop: 6 }}>
            Quản trị viên chưa đăng bản cài nào cho cấu hình máy của bạn. Xem các bản khác bên dưới
            hoặc liên hệ quản trị viên.
          </p>
        </div>
      )}
    </div>
  );
}

/** Ghi chú cài đặt cho từng nền tảng — lấy từ README của sản phẩm. */
function InstallNotes({ platform, appName }) {
  const showMac = platform !== 'win32';
  const showWin = platform !== 'darwin';
  return (
    <section className="stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>Cách cài đặt</h2>
        <p>Bản cài chưa ký số nên hệ điều hành có thể hỏi lại một lần — làm theo các bước dưới đây.</p>
      </div>

      <div className="install-grid">
        {showMac && (
          <div className="card">
            <div className="card-head">
              <span className="ico">
                <OsIcon platform="darwin" />
              </span>
              <h3>macOS</h3>
            </div>
            <ol>
              <li>
                Mở file <code>.dmg</code> vừa tải, kéo <b>{appName}</b> vào thư mục <b>Applications</b>.
              </li>
              <li>
                Lần đầu mở, macOS có thể chặn vì ứng dụng chưa ký số: <b>chuột phải vào ứng dụng → Mở</b>{' '}
                (không mở bằng cách bấm đúp), rồi bấm <b>Mở</b> ở hộp thoại xác nhận.
              </li>
              <li>
                Vẫn bị chặn? Mở Terminal và chạy:
                <div className="cmd">
                  <code>{QUARANTINE_CMD}</code>
                  <CopyButton value={QUARANTINE_CMD} />
                </div>
              </li>
              <li>
                Chọn đúng chip: <b>Mac chip Apple (M1/M2/M3…)</b> dùng bản <code>arm64</code>,{' '}
                <b>Mac Intel</b> dùng bản <code>x64</code>. Xem chip ở <b>menu Apple → Giới thiệu về máy
                Mac này</b>.
              </li>
            </ol>
          </div>
        )}

        {showWin && (
          <div className="card">
            <div className="card-head">
              <span className="ico">
                <OsIcon platform="win32" />
              </span>
              <h3>
                Windows <span className="pill warn">thử nghiệm</span>
              </h3>
            </div>
            <ol>
              <li>
                <b>Trình duyệt báo chặn tệp tải về?</b> Bản cài chưa ký số nên Edge/Chrome coi là tệp lạ,
                không phải virus. Edge: mở danh sách tải (<b>Ctrl+J</b>), bấm <b>⋯</b> cạnh tệp →{' '}
                <b>Giữ lại</b> → <b>Hiển thị thêm</b> → <b>Vẫn giữ lại</b>. Chrome: bấm <b>⋮</b> cạnh tệp →{' '}
                <b>Giữ lại</b> → <b>Vẫn tải xuống</b>.
              </li>
              <li>
                Chạy file <code>.exe</code> vừa tải. Trình cài cho chọn thư mục và tạo lối tắt.
              </li>
              <li>
                SmartScreen hiện cảnh báo "Windows đã bảo vệ máy tính của bạn": bấm <b>Thông tin thêm</b>{' '}
                → <b>Vẫn chạy</b>.
              </li>
              <li>
                Thư mục dữ liệu: <code>%APPDATA%\{appName}\data</code>. Thư mục làm việc cho Claude:{' '}
                <code>C:\Users\&lt;tên&gt;\Documents\{appName}</code>.
              </li>
            </ol>
            <div className="warnbox" style={{ marginTop: 14 }}>
              Bản Windows đang trong giai đoạn thử nghiệm, chưa kiểm tra đầy đủ trên máy Windows thật.
              Gặp lỗi hãy báo quản trị viên.
            </div>
          </div>
        )}

        <div className="card" style={{ gridColumn: showMac && showWin ? 'auto' : '1 / -1' }}>
          <div className="card-head">
            <span className="ico">✅</span>
            <h3>Sau khi cài</h3>
          </div>
          <ol>
            <li>
              Đăng nhập bằng tài khoản ứng dụng (email + mật khẩu, có mã đăng ký nếu công ty yêu cầu).
              Chưa có tài khoản? <Link to="/dang-ky">Đăng ký tại đây</Link>.
            </li>
            <li>
              Vào <b>Kết nối</b> ở thanh trái: quét mã QR <b>Zalo</b> (Zalo trên điện thoại → biểu tượng
              QR → quét → Đồng ý), đăng nhập <b>Telegram</b>, điền <b>Email IMAP</b> và <b>Lark Approval</b>{' '}
              nếu dùng. Mỗi thẻ có nút <b>Kiểm tra kết nối</b>.
            </li>
            <li>
              Bật <b>Cài đặt → Tự mở ứng dụng khi bật máy</b> và <b>Giữ máy không ngủ</b> để không bỏ lỡ
              tin nhắn và bản tin đúng giờ.
            </li>
            <li>
              Đặt <b>Bot Telegram gửi bản tin</b> (bot token, chat ID, giọng đọc, giờ gửi) để nhận bản tin
              giọng nói; hoặc trỏ Claude Cowork vào <code>~/Documents/{appName}</code>.
            </li>
          </ol>
          <div className="hint" style={{ marginTop: 14 }}>
            Không mở <b>chat.zalo.me</b> trên trình duyệt trong lúc ứng dụng đang chạy — Zalo chỉ cho một
            phiên web, mở thêm sẽ làm ứng dụng mất kết nối.
          </div>
        </div>
      </div>
    </section>
  );
}
