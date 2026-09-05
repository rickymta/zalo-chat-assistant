import { useRef, useState } from 'react';
import { del, post, put, uploadWithProgress } from '../api.js';
import { useFetch } from '../lib/useFetch.js';
import { Modal, useConfirm } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { EmptyState, ErrorBox, Loading, ProgressBar, Prose } from '../components/ui.jsx';
import { channelLabel, compareSemverDesc, formatBytes, formatDate, formatNumber } from '../lib/format.js';
import { targetLabel } from '../lib/platform.js';

const PLATFORMS = [
  { value: 'darwin', label: 'macOS' },
  { value: 'win32', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
];
const ARCHES = [
  { value: 'arm64', label: 'arm64 (chip Apple)' },
  { value: 'x64', label: 'x64 (Intel/AMD)' },
  { value: 'universal', label: 'universal (mọi chip)' },
];

const EMPTY = {
  version: '',
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64',
  notes: '',
  mandatory: false,
  minVersion: '',
  externalUrl: '',
};

export default function ReleasesAdmin() {
  const { data, loading, error, reload } = useFetch('/api/admin/releases');
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const items = [...((data && data.items) || [])].sort(
    (a, b) => compareSemverDesc(a.version, b.version) || String(a.platform).localeCompare(String(b.platform)),
  );

  const togglePublish = async (r) => {
    const publishing = !r.publishedAt;
    if (!publishing) {
      const ok = await confirm({
        title: 'Gỡ bản phát hành?',
        message: `Bản ${r.version} (${targetLabel(r.platform, r.arch)}) sẽ biến mất khỏi website và khỏi luồng kiểm tra cập nhật của ứng dụng.`,
        detail: 'Người đang dùng bản này không bị ảnh hưởng; chỉ là không ai tải mới được nữa.',
        confirmText: 'Gỡ bản này',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await post(`/api/admin/releases/${encodeURIComponent(r.id)}/publish`, { published: publishing });
      toastOk(publishing ? 'Đã xuất bản.' : 'Đã gỡ bản phát hành.');
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };

  const remove = async (r) => {
    const ok = await confirm({
      title: 'Xoá bản phát hành?',
      message: `Bản ${r.version} (${targetLabel(r.platform, r.arch)}) sẽ bị xoá vĩnh viễn.`,
      detail: 'Tệp cài đặt trên máy chủ cũng bị xoá theo. Không khôi phục lại được.',
      confirmText: 'Xoá vĩnh viễn',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/admin/releases/${encodeURIComponent(r.id)}`);
      toastOk('Đã xoá bản phát hành.');
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Phiên bản</h1>
          <p>Bản cài đặt cho từng hệ điều hành. Chỉ bản đã xuất bản mới hiện trên website.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          + Đăng bản mới
        </button>
      </div>

      <div className="toolbar">
        <span className="grow" />
        <button type="button" onClick={reload}>
          ↻ Làm mới
        </button>
      </div>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải danh sách phiên bản…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📦"
          title="Chưa có bản phát hành nào"
          hint="Đăng bản cài đầu tiên để người dùng tải về."
          action={
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              + Đăng bản mới
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Phiên bản</th>
                <th>Nền tảng</th>
                <th>Kênh</th>
                <th>Tệp</th>
                <th>Lượt tải</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.version}</b>
                    {r.mandatory && (
                      <>
                        <br />
                        <span className="pill bad">Bắt buộc</span>
                      </>
                    )}
                    {r.minVersion && (
                      <>
                        <br />
                        <span className="small faint">tối thiểu {r.minVersion}</span>
                      </>
                    )}
                  </td>
                  <td>{targetLabel(r.platform, r.arch)}</td>
                  <td>
                    <span className={`pill ${r.channel === 'beta' ? 'warn' : ''}`}>
                      {channelLabel(r.channel)}
                    </span>
                  </td>
                  <td>
                    {r.externalUrl ? (
                      <a href={r.externalUrl} target="_blank" rel="noreferrer">
                        Liên kết ngoài
                      </a>
                    ) : (
                      <>
                        <span className="small mono">{r.fileName}</span>
                        <br />
                        <span className="small faint">{formatBytes(r.fileSize)}</span>
                      </>
                    )}
                  </td>
                  <td>{formatNumber(r.downloads)}</td>
                  <td>
                    {r.publishedAt ? (
                      <>
                        <span className="pill ok">Đã xuất bản</span>
                        <br />
                        <span className="small faint">{formatDate(r.publishedAt)}</span>
                      </>
                    ) : (
                      <span className="pill warn">Nháp</span>
                    )}
                  </td>
                  <td className="actions">
                    <button type="button" className="sm" onClick={() => togglePublish(r)}>
                      {r.publishedAt ? 'Gỡ' : 'Xuất bản'}
                    </button>
                    <button type="button" className="sm" onClick={() => setEditing(r)}>
                      Sửa
                    </button>
                    <button type="button" className="sm danger" onClick={() => remove(r)}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateRelease
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
      {editing && (
        <EditRelease
          release={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/** Form tạo bản mới: có tệp cài (kéo-thả, hiện tiến trình) hoặc liên kết ngoài. */
function CreateRelease({ onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY });
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const confirm = useConfirm();
  const { toastOk } = useToast();

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
  };

  const takeFile = (f) => {
    if (!f) return;
    if (f.size > 600 * 1024 * 1024) {
      setError(new Error('Tệp vượt quá giới hạn 600 MB.'));
      return;
    }
    setError(null);
    setFile(f);
    // Đoán nền tảng theo đuôi tệp cho đỡ phải chọn tay.
    const name = f.name.toLowerCase();
    if (name.endsWith('.dmg')) {
      setForm((s) => ({
        ...s,
        platform: 'darwin',
        arch: name.includes('x64') ? 'x64' : name.includes('arm64') ? 'arm64' : s.arch,
      }));
    } else if (name.endsWith('.exe')) {
      setForm((s) => ({ ...s, platform: 'win32', arch: 'x64' }));
    }
    // Đoán số phiên bản dạng 1.2.3 trong tên tệp.
    const m = f.name.match(/(\d+\.\d+\.\d+)/);
    if (m) setForm((s) => ({ ...s, version: s.version || m[1] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!/^\d+\.\d+\.\d+/.test(form.version.trim())) {
      setError(new Error('Số phiên bản phải theo dạng semver, ví dụ 1.2.0.'));
      return;
    }
    if (!file && !form.externalUrl.trim()) {
      setError(new Error('Chọn tệp cài đặt hoặc nhập liên kết ngoài.'));
      return;
    }
    setBusy(true);
    setPct(0);
    try {
      const fd = new FormData();
      fd.append('version', form.version.trim());
      fd.append('channel', form.channel);
      fd.append('platform', form.platform);
      fd.append('arch', form.arch);
      fd.append('notes', form.notes);
      fd.append('mandatory', form.mandatory ? 'true' : 'false');
      if (form.minVersion.trim()) fd.append('minVersion', form.minVersion.trim());
      if (form.externalUrl.trim()) fd.append('externalUrl', form.externalUrl.trim());
      if (file) fd.append('file', file);
      await uploadWithProgress('/api/admin/releases', fd, setPct);
      toastOk('Đã tạo bản phát hành (đang ở trạng thái nháp).');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const tryClose = async () => {
    if (busy) {
      const ok = await confirm({
        title: 'Huỷ tải tệp lên?',
        message: 'Tệp đang được tải lên máy chủ. Đóng bây giờ sẽ huỷ giữa chừng.',
        confirmText: 'Đóng, huỷ tải lên',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Modal
      open
      width="wide"
      closeOnBackdrop={false}
      title="Đăng bản phát hành mới"
      onClose={tryClose}
      footer={
        <>
          <button type="button" onClick={tryClose}>
            Huỷ
          </button>
          <button type="button" className="primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner on-primary" />}
            {busy ? `Đang tải lên ${pct}%…` : 'Tạo bản phát hành'}
          </button>
        </>
      }
    >
      <form className="col" onSubmit={submit}>
        <ErrorBox error={error} />

        <div className="hint">
          Bản mới tạo ra ở trạng thái <b>Nháp</b>. Kiểm tra lại rồi bấm <b>Xuất bản</b> ở danh sách để
          người dùng thấy và ứng dụng báo cập nhật.
        </div>

        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            takeFile(e.dataTransfer.files && e.dataTransfer.files[0]);
          }}
        >
          <div className="big">📦</div>
          {file ? (
            <>
              <div className="file">{file.name}</div>
              <div className="small muted">{formatBytes(file.size)} · bấm để chọn tệp khác</div>
            </>
          ) : (
            <>
              <b>Kéo tệp cài đặt vào đây</b>
              <div className="small muted">
                hoặc bấm để chọn — .dmg (macOS), .exe (Windows). Tối đa 600 MB.
              </div>
            </>
          )}
          {busy && (
            <div style={{ marginTop: 12 }}>
              <ProgressBar percent={pct} />
              <div className="small muted" style={{ marginTop: 6 }}>
                Đã tải {pct}%
              </div>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".dmg,.exe,.zip,.AppImage,.deb"
          onChange={(e) => {
            takeFile(e.target.files && e.target.files[0]);
            e.target.value = '';
          }}
        />

        <div className="fld">
          <label htmlFor="ext">
            Hoặc liên kết ngoài <em>(dùng khi tệp đã nằm ở nơi khác)</em>
          </label>
          <input
            id="ext"
            type="url"
            value={form.externalUrl}
            onChange={set('externalUrl')}
            placeholder="https://…/Zalo Chat Assistant-1.2.0-arm64.dmg"
          />
        </div>

        <div className="three">
          <div className="fld">
            <label htmlFor="version">Số phiên bản</label>
            <input
              id="version"
              type="text"
              value={form.version}
              onChange={set('version')}
              placeholder="1.2.0"
              required
            />
          </div>
          <div className="fld">
            <label htmlFor="platform">Hệ điều hành</label>
            <select id="platform" value={form.platform} onChange={set('platform')}>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="arch">Kiến trúc</label>
            <select id="arch" value={form.arch} onChange={set('arch')}>
              {ARCHES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="three">
          <div className="fld">
            <label htmlFor="channel">Kênh phát hành</label>
            <select id="channel" value={form.channel} onChange={set('channel')}>
              <option value="stable">Ổn định</option>
              <option value="beta">Thử nghiệm</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="minv">
              Phiên bản tối thiểu <em>(không bắt buộc)</em>
            </label>
            <input
              id="minv"
              type="text"
              value={form.minVersion}
              onChange={set('minVersion')}
              placeholder="1.0.0"
            />
            <span className="help">Bản cũ hơn mốc này sẽ bị buộc cập nhật.</span>
          </div>
          <div className="fld">
            <span className="lbl">Tuỳ chọn</span>
            <label className="check">
              <input type="checkbox" checked={form.mandatory} onChange={set('mandatory')} />
              Bắt buộc cập nhật
            </label>
            <span className="help">Người dùng không thể bấm “Bỏ qua bản này”.</span>
          </div>
        </div>

        <NotesEditor value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
      </form>
    </Modal>
  );
}

/** Sửa bản đã có: theo hợp đồng chỉ đổi được notes/mandatory/minVersion/channel/externalUrl. */
function EditRelease({ release, onClose, onSaved }) {
  const [form, setForm] = useState({
    notes: release.notes || '',
    mandatory: !!release.mandatory,
    minVersion: release.minVersion || '',
    channel: release.channel || 'stable',
    externalUrl: release.externalUrl || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { toastOk } = useToast();

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await put(`/api/admin/releases/${encodeURIComponent(release.id)}`, {
        notes: form.notes,
        mandatory: !!form.mandatory,
        minVersion: form.minVersion.trim() || null,
        channel: form.channel,
        externalUrl: form.externalUrl.trim() || null,
      });
      toastOk('Đã lưu thay đổi.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width="wide"
      closeOnBackdrop={false}
      title={`Sửa bản ${release.version} — ${targetLabel(release.platform, release.arch)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button type="button" className="primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner on-primary" />}
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </>
      }
    >
      <form className="col" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="hint">
          Không đổi được số phiên bản, hệ điều hành, kiến trúc hay tệp cài. Cần thay tệp thì tạo bản mới
          rồi xoá bản này.
        </div>

        <div className="three">
          <div className="fld">
            <label htmlFor="e-channel">Kênh phát hành</label>
            <select id="e-channel" value={form.channel} onChange={set('channel')}>
              <option value="stable">Ổn định</option>
              <option value="beta">Thử nghiệm</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="e-minv">Phiên bản tối thiểu</label>
            <input id="e-minv" type="text" value={form.minVersion} onChange={set('minVersion')} placeholder="1.0.0" />
          </div>
          <div className="fld">
            <span className="lbl">Tuỳ chọn</span>
            <label className="check">
              <input type="checkbox" checked={form.mandatory} onChange={set('mandatory')} />
              Bắt buộc cập nhật
            </label>
          </div>
        </div>

        <div className="fld">
          <label htmlFor="e-ext">Liên kết ngoài</label>
          <input id="e-ext" type="url" value={form.externalUrl} onChange={set('externalUrl')} placeholder="https://…" />
          <span className="help">Có giá trị ở đây thì người dùng tải từ liên kết này thay vì tệp trên máy chủ.</span>
        </div>

        <NotesEditor value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
      </form>
    </Modal>
  );
}

function NotesEditor({ value, onChange }) {
  return (
    <div className="fld">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="lbl">Ghi chú thay đổi (Markdown)</span>
        <span className="small faint">Hiện ở trang Cập nhật và trong ứng dụng</span>
      </div>
      <div className="editor-split">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'### Mới\n- Thêm báo cáo ngày\n\n### Sửa lỗi\n- Không mất kết nối khi máy thức dậy'}
          spellCheck={false}
          style={{ minHeight: 240 }}
        />
        <div className="preview-pane" style={{ minHeight: 240 }}>
          {value.trim() ? <Prose md={value} /> : <p className="faint">Xem trước ghi chú sẽ hiện ở đây.</p>}
        </div>
      </div>
    </div>
  );
}
