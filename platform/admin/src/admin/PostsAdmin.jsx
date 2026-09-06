import { useMemo, useRef, useState } from 'react';
import { del, post, put, uploadWithProgress } from '../api.js';
import { useFetch } from '../lib/useFetch.js';
import { Modal, useConfirm } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { EmptyState, ErrorBox, Loading, Prose } from '../components/ui.jsx';
import { formatDate, slugify } from '../lib/format.js';

const KINDS = [
  { value: 'post', label: 'Bài viết' },
  { value: 'page', label: 'Trang hướng dẫn' },
  { value: 'changelog', label: 'Ghi chú phát hành' },
];

const EMPTY = {
  title: '',
  slug: '',
  excerpt: '',
  contentMd: '',
  coverImageUrl: '',
  tags: '',
  kind: 'post',
  pinned: false,
  published: false,
};

export default function PostsAdmin() {
  const { data, loading, error, reload } = useFetch('/api/admin/posts');
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const [editing, setEditing] = useState(null); // null = đóng form
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  const items = useMemo(() => {
    let list = (data && data.items) || [];
    if (kindFilter) list = list.filter((p) => p.kind === kindFilter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (p) =>
          String(p.title || '').toLowerCase().includes(needle) ||
          String(p.slug || '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [data, q, kindFilter]);

  const remove = async (item) => {
    const ok = await confirm({
      title: 'Xoá bài viết?',
      message: `Bài “${item.title}” sẽ bị xoá vĩnh viễn.`,
      detail: 'Không khôi phục lại được. Nếu chỉ muốn ẩn khỏi website, hãy chuyển bài về trạng thái Nháp.',
      confirmText: 'Xoá bài',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/admin/posts/${encodeURIComponent(item.id)}`);
      toastOk('Đã xoá bài viết.');
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };

  const togglePublish = async (item) => {
    try {
      await put(`/api/admin/posts/${encodeURIComponent(item.id)}`, {
        publishedAt: item.publishedAt ? null : Date.now(),
      });
      toastOk(item.publishedAt ? 'Đã chuyển về nháp.' : 'Đã xuất bản.');
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };

  const togglePin = async (item) => {
    try {
      await put(`/api/admin/posts/${encodeURIComponent(item.id)}`, { pinned: !item.pinned });
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Bài viết</h1>
          <p>Bài viết, trang hướng dẫn và ghi chú phát hành hiển thị trên website.</p>
        </div>
        <button type="button" className="primary" onClick={() => setEditing({ ...EMPTY })}>
          + Viết bài mới
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Tìm theo tiêu đề hoặc slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">Tất cả loại</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button type="button" onClick={reload}>
          ↻ Làm mới
        </button>
      </div>

      <ErrorBox error={error} onRetry={reload} />

      {loading ? (
        <Loading text="Đang tải danh sách bài viết…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📝"
          title="Chưa có bài nào"
          hint="Bấm “Viết bài mới” để tạo bài đầu tiên."
          action={
            <button type="button" className="primary" onClick={() => setEditing({ ...EMPTY })}>
              + Viết bài mới
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Tiêu đề</th>
                <th>Loại</th>
                <th>Trạng thái</th>
                <th>Ngày xuất bản</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.title}</b>
                    {p.pinned && <span className="tag" style={{ marginLeft: 8 }}>📌 Ghim</span>}
                    <br />
                    <span className="small faint mono">/{p.slug}</span>
                  </td>
                  <td>{KINDS.find((k) => k.value === p.kind)?.label || p.kind}</td>
                  <td>
                    {p.publishedAt ? (
                      <span className="pill ok">Đã xuất bản</span>
                    ) : (
                      <span className="pill warn">Nháp</span>
                    )}
                  </td>
                  <td>{p.publishedAt ? formatDate(p.publishedAt) : '—'}</td>
                  <td className="actions">
                    <button type="button" className="sm" onClick={() => togglePin(p)}>
                      {p.pinned ? 'Bỏ ghim' : 'Ghim'}
                    </button>
                    <button type="button" className="sm" onClick={() => togglePublish(p)}>
                      {p.publishedAt ? 'Về nháp' : 'Xuất bản'}
                    </button>
                    <button
                      type="button"
                      className="sm"
                      onClick={() =>
                        setEditing({
                          id: p.id,
                          title: p.title || '',
                          slug: p.slug || '',
                          excerpt: p.excerpt || '',
                          contentMd: p.contentMd || '',
                          coverImageUrl: p.coverImageUrl || '',
                          tags: (p.tags || []).join(', '),
                          kind: p.kind || 'post',
                          pinned: !!p.pinned,
                          published: !!p.publishedAt,
                          publishedAt: p.publishedAt || null,
                        })
                      }
                    >
                      Sửa
                    </button>
                    <button type="button" className="sm danger" onClick={() => remove(p)}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PostEditor
          value={editing}
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

function PostEditor({ value, onClose, onSaved }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileRef = useRef(null);
  const confirm = useConfirm();
  const { toastOk, toastError } = useToast();
  const isNew = !form.id;

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
  };

  const pickCover = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastError('Chỉ nhận tệp ảnh.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toastError('Ảnh không được vượt quá 10 MB.');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await uploadWithProgress('/api/admin/uploads', fd, setUploadPct);
      if (res && res.url) {
        setForm((f) => ({ ...f, coverImageUrl: res.url }));
        toastOk('Đã tải ảnh bìa lên.');
      }
    } catch (err) {
      toastError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError(new Error('Nhập tiêu đề bài viết.'));
      return;
    }
    setBusy(true);
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || undefined, // bỏ trống ⇒ máy chủ tự sinh từ tiêu đề
      excerpt: form.excerpt.trim(),
      contentMd: form.contentMd,
      coverImageUrl: form.coverImageUrl || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      kind: form.kind,
      pinned: !!form.pinned,
      publishedAt: form.published ? form.publishedAt || Date.now() : null,
    };
    try {
      if (isNew) await post('/api/admin/posts', payload);
      else await put(`/api/admin/posts/${encodeURIComponent(form.id)}`, payload);
      toastOk(isNew ? 'Đã tạo bài viết.' : 'Đã lưu bài viết.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const tryClose = async () => {
    const ok = await confirm({
      title: 'Đóng mà không lưu?',
      message: 'Những thay đổi chưa lưu sẽ mất.',
      confirmText: 'Đóng, không lưu',
      danger: true,
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      width="xwide"
      closeOnBackdrop={false}
      title={isNew ? 'Viết bài mới' : `Sửa bài: ${value.title}`}
      onClose={tryClose}
      footer={
        <>
          <button type="button" onClick={tryClose} disabled={busy}>
            Huỷ
          </button>
          <button type="button" className="primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner on-primary" />}
            {busy ? 'Đang lưu…' : form.published ? 'Lưu & xuất bản' : 'Lưu nháp'}
          </button>
        </>
      }
    >
      <form className="col" onSubmit={save}>
        <ErrorBox error={error} />

        <div className="two">
          <div className="fld">
            <label htmlFor="title">Tiêu đề</label>
            <input
              id="title"
              type="text"
              value={form.title}
              onChange={(e) => {
                const title = e.target.value;
                setForm((f) => ({
                  ...f,
                  title,
                  // Bài mới: slug tự chạy theo tiêu đề cho tới khi người dùng tự sửa slug.
                  slug: isNew && (!f.slug || f.slug === slugify(f.title)) ? slugify(title) : f.slug,
                }));
              }}
              placeholder="Ví dụ: Cách kết nối Zalo bằng mã QR"
              required
              autoFocus
            />
          </div>
          <div className="fld">
            <label htmlFor="slug">
              Slug <em>(bỏ trống để máy chủ tự sinh)</em>
            </label>
            <input
              id="slug"
              type="text"
              className="mono"
              value={form.slug}
              onChange={set('slug')}
              placeholder="cach-ket-noi-zalo-bang-ma-qr"
            />
          </div>
        </div>

        <div className="three">
          <div className="fld">
            <label htmlFor="kind">Loại</label>
            <select id="kind" value={form.kind} onChange={set('kind')}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <span className="help">
              “Trang hướng dẫn” hiện ở mục Hướng dẫn, còn lại hiện ở mục Bài viết.
            </span>
          </div>
          <div className="fld">
            <label htmlFor="tags">
              Thẻ <em>(cách nhau dấu phẩy)</em>
            </label>
            <input id="tags" type="text" value={form.tags} onChange={set('tags')} placeholder="hướng dẫn, zalo" />
          </div>
          <div className="fld">
            <span className="lbl">Hiển thị</span>
            <label className="check">
              <input type="checkbox" checked={!!form.published} onChange={set('published')} />
              Xuất bản (bỏ chọn = nháp)
            </label>
            <label className="check">
              <input type="checkbox" checked={!!form.pinned} onChange={set('pinned')} />
              Ghim lên đầu
            </label>
          </div>
        </div>

        <div className="fld">
          <label htmlFor="excerpt">Mô tả ngắn</label>
          <textarea
            id="excerpt"
            rows={2}
            value={form.excerpt}
            onChange={set('excerpt')}
            placeholder="Một hai câu tóm tắt, hiện trên thẻ bài viết ở danh sách."
          />
        </div>

        <div className="fld">
          <span className="lbl">Ảnh bìa</span>
          <div className="cover-preview">
            {form.coverImageUrl ? (
              <>
                <img src={form.coverImageUrl} alt="Ảnh bìa" />
                <div className="col" style={{ gap: 8 }}>
                  <span className="small mono">{form.coverImageUrl}</span>
                  <div className="row">
                    <button type="button" className="sm" onClick={() => fileRef.current?.click()}>
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="sm danger"
                      onClick={() => setForm((f) => ({ ...f, coverImageUrl: '' }))}
                    >
                      Bỏ ảnh
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? `Đang tải lên ${uploadPct}%…` : '🖼️ Tải ảnh bìa lên'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pickCover(e.target.files && e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>
          <span className="help">Ảnh JPG/PNG/WebP tối đa 10 MB. Tỉ lệ đẹp nhất là 16:9.</span>
        </div>

        <div className="fld">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="lbl">Nội dung (Markdown)</span>
            <span className="small faint">Gõ bên trái, xem trước bên phải</span>
          </div>
          <div className="editor-split">
            <textarea
              value={form.contentMd}
              onChange={set('contentMd')}
              placeholder={'## Tiêu đề mục\n\nNội dung đoạn văn.\n\n- Gạch đầu dòng\n- **In đậm**, [liên kết](https://…)'}
              spellCheck={false}
            />
            <div className="preview-pane">
              {form.contentMd.trim() ? (
                <Prose md={form.contentMd} />
              ) : (
                <p className="faint">Xem trước sẽ hiện ở đây khi bạn bắt đầu gõ.</p>
              )}
            </div>
          </div>
          <span className="help">
            Máy chủ sẽ render lại Markdown và làm sạch HTML khi lưu — bản xem trước ở đây chỉ để soạn
            cho nhanh.
          </span>
        </div>
      </form>
    </Modal>
  );
}
