import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useSite } from '../site.jsx';
import { TARGETS, detectTarget, targetLabel } from '../lib/platform.js';
import { channelLabel, formatBytes, formatDate } from '../lib/format.js';
import { CopyButton, ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { TargetCard } from '../components/ReleaseCard.jsx';

export default function Download() {
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

  return (
    <div className="wrap">
      <div className="stack">
        <div>
          <h1>Tải Zalo Chat Assistant</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Ứng dụng chạy trên máy của bạn. Cài xong, đăng nhập tài khoản rồi quét mã QR Zalo là dùng
            được.
          </p>
        </div>

        {loading ? (
          <Loading text="Đang nhận diện máy của bạn…" />
        ) : (
          <>
            <ErrorBox error={error} />
            <MainDownload target={target} release={release} />
          </>
        )}

        <section>
          <h2 style={{ marginBottom: 6 }}>Bản cho nền tảng khác</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Cài cho máy khác, hoặc bạn dùng Mac Intel/Windows.
          </p>
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
          <p className="small muted" style={{ marginTop: 14 }}>
            Xem toàn bộ lịch sử phát hành và ghi chú từng bản ở trang{' '}
            <Link to="/cap-nhat">Cập nhật</Link>.
          </p>
        </section>

        <InstallNotes platform={target ? target.platform : null} />
      </div>
    </div>
  );
}

function MainDownload({ target, release }) {
  if (target && !target.supported) {
    return (
      <div className="hero-download">
        <div className="warnbox">
          <b>Máy bạn đang dùng không cài được ứng dụng.</b>
          <p style={{ marginTop: 6 }}>
            Zalo Chat Assistant là ứng dụng cho máy tính (macOS hoặc Windows). Bạn đang mở trang này
            trên {target.label || 'thiết bị di động'}. Hãy mở lại trang này trên máy tính, hoặc chọn
            bản cài bên dưới rồi chép sang máy tính.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hero-download">
      <div className="target-line">
        <span className="pill info">💻 Máy của bạn</span>
        <b style={{ fontSize: 17 }}>{target ? target.label : 'Không rõ'}</b>
        {target && !target.confident && (
          <span className="small faint">
            (nhận diện tự động — nếu không đúng, chọn bản khác ở danh sách bên dưới)
          </span>
        )}
      </div>

      {release ? (
        <>
          <div className="row" style={{ gap: 14 }}>
            <a className="btn primary xl" href={release.downloadUrl} download>
              ⬇️ Tải bản {release.version}
            </a>
            <div className="small muted">
              {release.fileName}
              <br />
              {formatBytes(release.fileSize)} · phát hành {formatDate(release.publishedAt)}
              {release.channel === 'beta' ? ` · kênh ${channelLabel(release.channel)}` : ''}
            </div>
          </div>

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
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)' }}>
                Có gì mới trong bản {release.version}
              </summary>
              <div style={{ marginTop: 12 }}>
                <Prose html={release.notesHtml} />
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="warnbox">
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
function InstallNotes({ platform }) {
  const showMac = platform !== 'win32';
  const showWin = platform !== 'darwin';
  return (
    <section className="stack">
      <h2>Cách cài đặt</h2>

      {showMac && (
        <div className="card">
          <h3>🍎 macOS</h3>
          <ol className="prose" style={{ paddingLeft: 22, marginTop: 10 }}>
            <li>
              Mở file <code>.dmg</code> vừa tải, kéo <b>Zalo Chat Assistant</b> vào thư mục{' '}
              <b>Applications</b>.
            </li>
            <li>
              Lần đầu mở, macOS có thể chặn vì ứng dụng chưa ký số: <b>chuột phải vào ứng dụng → Mở</b>{' '}
              (không mở bằng cách bấm đúp), rồi bấm <b>Mở</b> ở hộp thoại xác nhận.
            </li>
            <li>
              Vẫn bị chặn? Mở Terminal và chạy:
              <div className="row" style={{ marginTop: 8 }}>
                <code>xattr -dr com.apple.quarantine "/Applications/Zalo Chat Assistant.app"</code>
                <CopyButton value={'xattr -dr com.apple.quarantine "/Applications/Zalo Chat Assistant.app"'} />
              </div>
            </li>
            <li>
              Chọn đúng chip: <b>Mac chip Apple (M1/M2/M3…)</b> dùng bản <code>arm64</code>, <b>Mac Intel</b>{' '}
              dùng bản <code>x64</code>. Xem chip ở <b>menu Apple → Giới thiệu về máy Mac này</b>.
            </li>
          </ol>
        </div>
      )}

      {showWin && (
        <div className="card">
          <h3>🪟 Windows (thử nghiệm)</h3>
          <ol className="prose" style={{ paddingLeft: 22, marginTop: 10 }}>
            <li>
              Chạy file <code>.exe</code> vừa tải. Trình cài cho chọn thư mục và tạo lối tắt.
            </li>
            <li>
              Bản chưa ký số nên SmartScreen sẽ hiện cảnh báo màu xanh: bấm <b>More info</b> →{' '}
              <b>Run anyway</b>.
            </li>
            <li>
              Thư mục dữ liệu của ứng dụng: <code>%APPDATA%\Zalo Chat Assistant\data</code>. Thư mục
              làm việc cho Claude: <code>C:\Users\&lt;tên&gt;\Documents\Zalo Chat Assistant</code>.
            </li>
          </ol>
          <div className="warnbox" style={{ marginTop: 12 }}>
            Bản Windows đang trong giai đoạn thử nghiệm, chưa kiểm tra đầy đủ trên máy Windows thật.
            Gặp lỗi hãy báo quản trị viên.
          </div>
        </div>
      )}

      <div className="card">
        <h3>Sau khi cài</h3>
        <ol className="prose" style={{ paddingLeft: 22, marginTop: 10 }}>
          <li>
            Đăng nhập bằng tài khoản ứng dụng (email + mật khẩu, có mã đăng ký nếu công ty yêu cầu).
            Chưa có tài khoản? <Link to="/dang-ky">Đăng ký tại đây</Link>.
          </li>
          <li>
            Ở thanh trên bấm <b>Đăng nhập Zalo (QR)</b>, mở Zalo trên điện thoại → biểu tượng QR →
            quét → Đồng ý.
          </li>
          <li>
            Bật <b>Cài đặt → Tự mở ứng dụng khi bật máy</b> và <b>Giữ máy không ngủ</b> để không bỏ lỡ
            tin nhắn.
          </li>
          <li>
            Trỏ Claude Cowork vào thư mục <code>~/Documents/Zalo Chat Assistant</code> rồi bấm{' '}
            <b>📁 Cập nhật dữ liệu cho Claude</b>.
          </li>
        </ol>
        <div className="hint" style={{ marginTop: 12 }}>
          Không mở <b>chat.zalo.me</b> trên trình duyệt trong lúc ứng dụng đang chạy — Zalo chỉ cho một
          phiên web, mở thêm sẽ làm ứng dụng mất kết nối.
        </div>
      </div>
    </section>
  );
}
