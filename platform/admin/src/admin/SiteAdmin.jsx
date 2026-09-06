import { useEffect, useState } from 'react';
import { put } from '../api.js';
import { useFetch } from '../lib/useFetch.js';
import { useSite } from '../site.jsx';
import { useConfirm } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading } from '../components/ui.jsx';

const EMPTY_FEATURE = { icon: '✨', title: '', text: '' };

export default function SiteAdmin() {
  const { data, loading, error, reload } = useFetch('/api/admin/site');
  const { reload: reloadSite } = useSite();
  const { toastOk } = useToast();
  const confirm = useConfirm();

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Nạp dữ liệu máy chủ vào form một lần khi tải xong.
  useEffect(() => {
    if (!data) return;
    setForm({
      appName: data.appName || '',
      tagline: data.tagline || '',
      hero: { title: (data.hero && data.hero.title) || '', subtitle: (data.hero && data.hero.subtitle) || '' },
      features: Array.isArray(data.features) ? data.features.map((f) => ({ ...f })) : [],
      contact: {
        email: (data.contact && data.contact.email) || '',
        phone: (data.contact && data.contact.phone) || '',
        zalo: (data.contact && data.contact.zalo) || '',
        address: (data.contact && data.contact.address) || '',
      },
    });
  }, [data]);

  if (loading || !form) {
    return (
      <>
        <div className="admin-head">
          <div>
            <h1>Trang chủ</h1>
            <p>Nội dung hiển thị ở đầu trang chủ và chân trang.</p>
          </div>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && <Loading text="Đang tải cấu hình…" />}
      </>
    );
  }

  const setField = (path, value) => {
    setForm((f) => {
      const next = { ...f };
      if (path.length === 1) next[path[0]] = value;
      else {
        next[path[0]] = { ...next[path[0]], [path[1]]: value };
      }
      return next;
    });
  };

  const setFeature = (idx, key, value) => {
    setForm((f) => {
      const features = f.features.map((x, i) => (i === idx ? { ...x, [key]: value } : x));
      return { ...f, features };
    });
  };

  const moveFeature = (idx, dir) => {
    setForm((f) => {
      const features = [...f.features];
      const to = idx + dir;
      if (to < 0 || to >= features.length) return f;
      [features[idx], features[to]] = [features[to], features[idx]];
      return { ...f, features };
    });
  };

  const removeFeature = async (idx) => {
    const ok = await confirm({
      title: 'Xoá mục tính năng?',
      message: `Mục “${form.features[idx].title || 'chưa đặt tên'}” sẽ bị bỏ khỏi trang chủ.`,
      confirmText: 'Xoá mục',
      danger: true,
    });
    if (!ok) return;
    setForm((f) => ({ ...f, features: f.features.filter((_, i) => i !== idx) }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaveError(null);
    setBusy(true);
    try {
      await put('/api/admin/site', {
        appName: form.appName.trim(),
        tagline: form.tagline.trim(),
        hero: { title: form.hero.title.trim(), subtitle: form.hero.subtitle.trim() },
        features: form.features
          .filter((f) => f.title.trim() || f.text.trim())
          .map((f) => ({ icon: f.icon || '', title: f.title.trim(), text: f.text.trim() })),
        contact: {
          email: form.contact.email.trim(),
          phone: form.contact.phone.trim(),
          zalo: form.contact.zalo.trim(),
          address: form.contact.address.trim(),
        },
      });
      toastOk('Đã lưu nội dung trang chủ.');
      reload();
      reloadSite(); // làm mới ngay header/footer/trang chủ đang mở
    } catch (err) {
      setSaveError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Trang chủ</h1>
          <p>Nội dung hiển thị ở đầu trang chủ, khối tính năng và thông tin liên hệ ở chân trang.</p>
        </div>
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy && <span className="spinner on-primary" />}
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>

      <form className="stack" onSubmit={save}>
        <ErrorBox error={saveError} />

        <div className="card">
          <h2>Tên và khẩu hiệu</h2>
          <p className="desc">Hiện ở logo góc trái, tiêu đề tab và chân trang.</p>
          <div className="two">
            <div className="fld">
              <label htmlFor="appName">Tên ứng dụng</label>
              <input
                id="appName"
                type="text"
                value={form.appName}
                onChange={(e) => setField(['appName'], e.target.value)}
                placeholder="Zalo Chat Assistant"
              />
            </div>
            <div className="fld">
              <label htmlFor="tagline">Khẩu hiệu ngắn</label>
              <input
                id="tagline"
                type="text"
                value={form.tagline}
                onChange={(e) => setField(['tagline'], e.target.value)}
                placeholder="Trợ lý hội thoại Zalo cho tư vấn viên"
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Khối mở đầu (hero)</h2>
          <p className="desc">Dòng tiêu đề lớn và đoạn mô tả ngay dưới, ở đầu trang chủ.</p>
          <div className="col">
            <div className="fld">
              <label htmlFor="heroTitle">Tiêu đề lớn</label>
              <input
                id="heroTitle"
                type="text"
                value={form.hero.title}
                onChange={(e) => setField(['hero', 'title'], e.target.value)}
                placeholder="Zalo Chat Assistant"
              />
            </div>
            <div className="fld">
              <label htmlFor="heroSub">Mô tả</label>
              <textarea
                id="heroSub"
                rows={3}
                value={form.hero.subtitle}
                onChange={(e) => setField(['hero', 'subtitle'], e.target.value)}
                placeholder="Kết nối Zalo cá nhân bằng mã QR, lưu tin nhắn mã hoá trên máy…"
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2>Khối tính năng</h2>
            <button
              type="button"
              className="sm"
              onClick={() => setForm((f) => ({ ...f, features: [...f.features, { ...EMPTY_FEATURE }] }))}
            >
              + Thêm mục
            </button>
          </div>
          <p className="desc">
            Mỗi mục là một thẻ trên trang chủ. Bỏ trống toàn bộ danh sách thì website dùng nội dung mặc
            định.
          </p>

          {form.features.length === 0 ? (
            <p className="muted">
              Chưa có mục nào — trang chủ đang hiện 6 tính năng mặc định. Thêm mục ở đây để thay thế.
            </p>
          ) : (
            <div className="col">
              {form.features.map((f, i) => (
                <div className="card tight" key={i} style={{ boxShadow: 'none', background: '#fbfcfe' }}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div className="fld" style={{ width: 90, flex: 'none' }}>
                      <label>Biểu tượng</label>
                      <input
                        type="text"
                        value={f.icon || ''}
                        onChange={(e) => setFeature(i, 'icon', e.target.value)}
                        placeholder="🔐"
                        style={{ textAlign: 'center', fontSize: 20 }}
                      />
                    </div>
                    <div className="fld grow">
                      <label>Tiêu đề</label>
                      <input
                        type="text"
                        value={f.title || ''}
                        onChange={(e) => setFeature(i, 'title', e.target.value)}
                        placeholder="Tin nhắn mã hoá trên máy bạn"
                      />
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 26 }}>
                      <button type="button" className="sm" onClick={() => moveFeature(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="sm"
                        onClick={() => moveFeature(i, 1)}
                        disabled={i === form.features.length - 1}
                      >
                        ↓
                      </button>
                      <button type="button" className="sm danger" onClick={() => removeFeature(i)}>
                        Xoá
                      </button>
                    </div>
                  </div>
                  <div className="fld" style={{ marginTop: 10 }}>
                    <label>Mô tả</label>
                    <textarea
                      rows={2}
                      value={f.text || ''}
                      onChange={(e) => setFeature(i, 'text', e.target.value)}
                      placeholder="Một hai câu giải thích tính năng."
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Thông tin liên hệ</h2>
          <p className="desc">Hiện ở chân trang. Bỏ trống mục nào thì mục đó không hiện.</p>
          <div className="two">
            <div className="fld">
              <label htmlFor="cEmail">Email</label>
              <input
                id="cEmail"
                type="email"
                value={form.contact.email}
                onChange={(e) => setField(['contact', 'email'], e.target.value)}
                placeholder="hotro@meddental.vn"
              />
            </div>
            <div className="fld">
              <label htmlFor="cPhone">Điện thoại</label>
              <input
                id="cPhone"
                type="text"
                value={form.contact.phone}
                onChange={(e) => setField(['contact', 'phone'], e.target.value)}
                placeholder="1900 xxxx"
              />
            </div>
            <div className="fld">
              <label htmlFor="cZalo">Zalo</label>
              <input
                id="cZalo"
                type="text"
                value={form.contact.zalo}
                onChange={(e) => setField(['contact', 'zalo'], e.target.value)}
                placeholder="MedDental"
              />
            </div>
            <div className="fld">
              <label htmlFor="cAddr">Địa chỉ</label>
              <input
                id="cAddr"
                type="text"
                value={form.contact.address}
                onChange={(e) => setField(['contact', 'address'], e.target.value)}
                placeholder="Số 1, đường ABC, Hà Nội"
              />
            </div>
          </div>
        </div>

        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy && <span className="spinner on-primary" />}
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
          <button type="button" onClick={reload} disabled={busy}>
            Khôi phục nội dung đã lưu
          </button>
        </div>
      </form>
    </>
  );
}
