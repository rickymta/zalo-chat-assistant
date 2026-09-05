import { useMemo, useState } from 'react';
import { useFetch } from '../lib/useFetch.js';
import { EmptyState, ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { compareSemverDesc, formatBytes, formatDate } from '../lib/format.js';
import { targetLabel } from '../lib/platform.js';

export default function Updates() {
  const [channel, setChannel] = useState('stable');
  const { data, loading, error, reload } = useFetch(`/api/releases?channel=${channel}&limit=50`, {
    auth: false,
    deps: [channel],
  });

  const groups = useMemo(() => groupByVersion((data && data.items) || []), [data]);

  return (
    <div className="wrap">
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1>Lịch sử phiên bản</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              Những gì đã thay đổi trong từng bản phát hành.
            </p>
          </div>
          <div className="row">
            <label className="lbl small muted" htmlFor="channel">
              Kênh
            </label>
            <select
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="stable">Ổn định</option>
              <option value="beta">Thử nghiệm</option>
            </select>
          </div>
        </div>

        <ErrorBox error={error} onRetry={reload} />

        {loading ? (
          <Loading text="Đang tải lịch sử phiên bản…" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon="🗒️"
            title="Chưa có bản phát hành nào trên kênh này"
            hint="Khi có bản mới, ghi chú thay đổi sẽ hiện ở đây."
          />
        ) : (
          groups.map((g, idx) => (
            <article className="release-item" key={g.version}>
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
                <p className="muted">Bản này không kèm ghi chú thay đổi.</p>
              )}

              <div className="release-files">
                {g.items.map((r) => (
                  <a key={r.id} className="btn sm" href={r.downloadUrl} download>
                    ⬇️ {targetLabel(r.platform, r.arch)} · {formatBytes(r.fileSize)}
                  </a>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
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
