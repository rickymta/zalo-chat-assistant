import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { EmptyState, ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { compareSemverDesc, formatBytes, formatDate } from '../lib/format.js';
import { targetLabel } from '../lib/platform.js';

const CHANNELS = [
  { value: 'stable', label: 'Ổn định' },
  { value: 'beta', label: 'Thử nghiệm' },
];

export default function Updates() {
  usePageTitle('Lịch sử phiên bản');
  const [channel, setChannel] = useState('stable');
  const { data, loading, error, reload } = useFetch(`/api/releases?channel=${channel}&limit=50`, {
    auth: false,
    deps: [channel],
  });

  const groups = useMemo(() => groupByVersion((data && data.items) || []), [data]);

  return (
    <div className="wrap">
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Lịch sử phiên bản</h1>
            <p>Những gì đã thay đổi trong từng bản phát hành, kèm tệp cài cho từng nền tảng.</p>
          </div>
          <div className="segmented" role="tablist" aria-label="Kênh phát hành">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={channel === c.value}
                className={channel === c.value ? 'active' : ''}
                onClick={() => setChannel(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <ErrorBox error={error} onRetry={reload} />

        {loading ? (
          <Loading text="Đang tải lịch sử phiên bản…" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon="🗒️"
            title={channel === 'beta' ? 'Chưa có bản thử nghiệm nào đang mở' : 'Chưa có bản phát hành nào'}
            hint={
              channel === 'beta'
                ? 'Bản thử nghiệm chỉ mở khi được mời. Hãy dùng kênh Ổn định.'
                : 'Khi có bản mới, ghi chú thay đổi sẽ hiện ở đây.'
            }
            action={
              channel === 'beta' ? (
                <button type="button" className="sm" onClick={() => setChannel('stable')}>
                  Về kênh Ổn định
                </button>
              ) : null
            }
          />
        ) : (
          <div className="timeline">
            {groups.map((g, idx) => (
              <article className={`release-item${idx === 0 ? ' latest' : ''}`} key={g.version}>
                <div className="head">
                  <h2>Phiên bản {g.version}</h2>
                  {idx === 0 && <span className="pill ok">Mới nhất</span>}
                  {g.mandatory && <span className="pill bad">Bắt buộc cập nhật</span>}
                  {g.channel === 'beta' && <span className="pill warn">Thử nghiệm</span>}
                  <span className="grow" />
                  <span className="small faint">{formatDate(g.publishedAt)}</span>
                </div>

                {g.minVersion && (
                  <p className="small muted" style={{ marginBottom: 10 }}>
                    Bản cũ hơn <b>{g.minVersion}</b> bắt buộc phải cập nhật lên bản này.
                  </p>
                )}

                {g.notesHtml ? (
                  <Prose html={g.notesHtml} />
                ) : (
                  <p className="muted">
                    Chưa có ghi chú chi tiết cho bản này. Xem{' '}
                    <Link to="/bai-viet/gioi-thieu-work-assistant">Giới thiệu Work Assistant</Link> để biết
                    ứng dụng làm được gì.
                  </p>
                )}

                <div className="release-files">
                  {g.items.map((r) => (
                    <a key={r.id} className="btn sm" href={r.downloadUrl} download>
                      ⬇ {targetLabel(r.platform, r.arch)} · {formatBytes(r.fileSize)}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && <UpdateHelp />}
      </div>
    </div>
  );
}

/** Hai khối giải thích cố định — trả lời "cập nhật thế nào?" và "kênh nào cho ai?". */
function UpdateHelp() {
  return (
    <section className="update-help">
      <div className="card">
        <div className="card-head">
          <span className="ico">🔄</span>
          <h3>Cách cập nhật</h3>
        </div>
        <p className="muted">
          Ứng dụng tự kiểm tra bản mới và báo ngay trong cửa sổ. Bạn cũng có thể vào{' '}
          <b>Cài đặt → Kiểm tra bản mới</b> bất cứ lúc nào, rồi tải và cài đè bản mới — dữ liệu, tài khoản
          và kết nối vẫn giữ nguyên.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <Link to="/tai-ve" className="btn sm">
            Tải bản mới nhất
          </Link>
          <Link to="/huong-dan" className="btn sm ghost">
            Hướng dẫn cài đặt
          </Link>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <span className="ico">🚦</span>
          <h3>Kênh phát hành</h3>
        </div>
        <ul className="prose" style={{ margin: '10px 0 0', paddingLeft: 20 }}>
          <li>
            <b>Ổn định</b> — bản khuyến nghị cho mọi người, đã kiểm tra kỹ.
          </li>
          <li>
            <b>Thử nghiệm</b> — bản có tính năng mới, có thể còn lỗi; chỉ dùng khi được mời.
          </li>
        </ul>
      </div>
    </section>
  );
}

/**
 * Gộp các bản tải cùng số phiên bản (mỗi nền tảng là một bản ghi Release riêng)
 * thành một mục lịch sử duy nhất.
 */
function groupByVersion(items) {
  const map = new Map();
  items.forEach((r) => {
    if (!map.has(r.version)) {
      map.set(r.version, {
        version: r.version,
        channel: r.channel,
        notesHtml: r.notesHtml || '',
        mandatory: !!r.mandatory,
        minVersion: r.minVersion || null,
        publishedAt: r.publishedAt || null,
        items: [],
      });
    }
    const g = map.get(r.version);
    g.items.push(r);
    if (!g.notesHtml && r.notesHtml) g.notesHtml = r.notesHtml;
    if (r.mandatory) g.mandatory = true;
    if (!g.minVersion && r.minVersion) g.minVersion = r.minVersion;
    // Lấy mốc phát hành sớm nhất trong nhóm làm ngày của phiên bản.
    if (r.publishedAt && (!g.publishedAt || r.publishedAt < g.publishedAt)) g.publishedAt = r.publishedAt;
  });
  return [...map.values()].sort((a, b) => compareSemverDesc(a.version, b.version));
}
