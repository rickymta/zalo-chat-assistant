(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = { locked: true, auth: {}, security: {}, accounts: [], stats: {}, settings: {}, paths: {}, platform: {}, workspace: {}, automation: null, filter: 'all', q: '', selected: null, qrKey: null, qrTimer: null, tab: 'login', sugByKey: {}, sugUnresolved: 0 };
  const PROMPT = 'Đọc huong-dan/00-chi-dan-cho-claude.md rồi tổng hợp tất cả hội thoại trong du-lieu/ và đề xuất phản hồi cho từng hội thoại.';
  const EMO = { '/-strong': '👍', '/-heart': '❤️', ':>': '😆', ':o': '😮', ':-((': '😢', ':-h': '😠', ':-*': '😘', ":')": '😂', '/-rose': '🌹', '/-break': '💔', '/-weak': '👎', ';xx': '😍', ';-/': '😕', ';-)': '😉', '/-ok': '👌', '/-v': '✌️', '/-thanks': '🙏', '/-punch': '👊', '_()_': '🙏', '/-no': '🚫', '/-loveu': '🥰', ':((': '😭', 'x-)': '😎', ';-d': '😁', 'b-)': '😎', ':-o': '😲', ':))': '🤣', '/-beer': '🍺', ':-)': '🙂', ':-(': '🙁', ':-D': '😀', ':-P': '😛', ':)': '🙂', ':(': '🙁', ':D': '😀' };
  const emo = (code) => EMO[code] || code;

  const fmtTime = (ms) => ms ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms)) : '';
  const fmtClock = (ms) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const fmtDay = (ms) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
  const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ms));
  const fmtRel = (ms) => { if (!ms) return ''; const d = Date.now() - ms; if (d < 60e3) return 'vừa xong'; if (d < 3600e3) return Math.floor(d / 60e3) + ' phút'; if (d < 86400e3) return fmtClock(ms); if (d < 7 * 86400e3) return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(new Date(ms)); return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(ms)); };
  const num = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  const avatarHtml = (url, name, cls = '') => url ? '<img class="avatar ' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<div class="avatar ' + cls + '">' + esc(initials(name)) + '</div>';
  const api = async (url, opt = {}) => {
    const headers = opt.body ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(url, { ...opt, headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423) { state.locked = true; showLogin(); }
    if (!res.ok) { const e = new Error(data.error || ('Lỗi ' + res.status)); e.status = res.status; e.data = data; throw e; }
    return data;
  };
  let toastTimer;
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800); };
  /** Sao chép: thử API trình duyệt trước; bị chặn (webview nhúng) thì nhờ ứng dụng ghi clipboard hệ thống. */
  const copyText = async (text, okMsg) => { const t = String(text ?? ''); try { await navigator.clipboard.writeText(t); toast(okMsg); return true; } catch { /* rơi xuống */ } try { await api('/api/clipboard', { method: 'POST', body: { text: t } }); toast(okMsg); return true; } catch (err) { toast('Không sao chép được: ' + err.message); return false; } };
  const busy = async (btn, label, fn) => { const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = label; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; } };
  const STATUS = { connected: ['ok', 'Đang kết nối'], connecting: ['warn', 'Đang kết nối…'], reconnecting: ['warn', 'Đang nối lại…'], need_relogin: ['bad', 'Cần đăng nhập lại'], disconnected: ['', 'Đã tạm dừng'], logged_out: ['', 'Đã đăng xuất'] };
  const visibleAccounts = () => state.accounts.filter((a) => a.status !== 'logged_out' || a.hasSession);
  const isMac = /Mac/.test(navigator.platform);

  // ── Đăng nhập máy chủ ─────────────────────────────────────────────────────
  function showLogin() { $('#loginView').hidden = false; $('#appView').hidden = true; if (!$('#serverUrl').value) $('#serverUrl').value = state.auth.serverUrl || ''; $('#serverUrlText').textContent = $('#serverUrl').value || state.auth.serverUrl || ''; }
  function showApp() { $('#loginView').hidden = true; $('#appView').hidden = false; $('#appView').classList.toggle('mac', isMac && state.platform?.name === 'electron'); }
  const setErr = (sel, msg) => { const el = $(sel); el.textContent = msg || ''; el.hidden = !msg; };
  function switchTab(name) { state.tab = name; $('#formLogin').hidden = name !== 'login'; $('#formRegister').hidden = name !== 'register'; $('#formForgot').hidden = name !== 'forgot'; ['#liErr', '#rgErr', '#fgErr'].forEach((s) => setErr(s, '')); const first = $(name === 'login' ? '#liEmail' : name === 'register' ? '#rgName' : '#fgEmail'); setTimeout(() => first?.focus(), 50); }
  $$('[data-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); switchTab(a.dataset.tab); }));
  $$('[data-eye]').forEach((b) => b.onclick = () => { const i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.style.opacity = i.type === 'text' ? '1' : ''; });
  $('#serverToggle').onclick = (e) => { e.preventDefault(); const ed = $('#serverEdit'); ed.hidden = !ed.hidden; if (!ed.hidden) $('#serverUrl').focus(); };
  $('#serverUrl').addEventListener('input', () => { $('#serverUrlText').textContent = $('#serverUrl').value.trim() || state.auth.serverUrl || ''; });
  const serverUrl = () => $('#serverUrl').value.trim() || undefined;
  /** 409 needsReset: máy đang giữ dữ liệu của danh tính khác — hỏi người dùng có xoá để tiếp tục không. */
  const confirmReset = (err) => err?.status === 409 && err?.data?.needsReset && confirm('Máy này đang giữ ' + num(err.data.messages) + ' tin nhắn / ' + num(err.data.conversations) + ' hội thoại của ' + (err.data.previous?.mode === 'local' ? 'chế độ dùng thử' : ('tài khoản ' + (err.data.previous?.email || 'khác'))) + '.\nDữ liệu đó KHÔNG đọc được bằng danh tính mới.\n\nXOÁ toàn bộ dữ liệu cũ trên máy này và tiếp tục?');
  /** Gọi đăng nhập/đăng ký; gặp 409 và người dùng đồng ý xoá thì gọi lại với resetData. */
  const authCall = async (path, body) => { try { return await api(path, { method: 'POST', body }); } catch (err) { if (confirmReset(err)) return api(path, { method: 'POST', body: { ...body, resetData: true } }); throw err; } };
  $('#formLogin').onsubmit = async (e) => { e.preventDefault(); setErr('#liErr', ''); await busy($('#liBtn'), 'Đang đăng nhập…', async () => { try { await authCall('/api/auth/login', { email: $('#liEmail').value, password: $('#liPassword').value, serverUrl: serverUrl() }); $('#liPassword').value = ''; await refreshState(); toast('Đã đăng nhập và mở khoá dữ liệu.'); } catch (err) { setErr('#liErr', err.message); } }); };
  $('#btnTrial').onclick = async () => {
    setErr('#liErr', '');
    if (!confirm('Dùng thử KHÔNG cần máy chủ trên máy này?\n\n• Ứng dụng tự tạo chuỗi mã hoá riêng, không cần Docker hay tài khoản.\n• Vẫn quét QR Zalo, lưu tin, tổng hợp bằng Claude như bình thường.\n• Dữ liệu chỉ đọc được trên máy này. Đăng xuất hoặc chuyển sang tài khoản thật sẽ XOÁ dữ liệu thử.')) return;
    await busy($('#btnTrial'), 'Đang tạo…', async () => { try { await authCall('/api/auth/local', {}); await refreshState(); toast('Đã vào chế độ dùng thử. Bước tiếp: đăng nhập Zalo bằng mã QR ở thanh trên.'); } catch (err) { setErr('#liErr', err.message); } });
  };
  $('#formRegister').onsubmit = async (e) => { e.preventDefault(); setErr('#rgErr', ''); if ($('#rgPassword').value !== $('#rgPassword2').value) { setErr('#rgErr', 'Hai mật khẩu không khớp.'); return; } await busy($('#rgBtn'), 'Đang tạo…', async () => { try { await authCall('/api/auth/register', { email: $('#rgEmail').value, password: $('#rgPassword').value, name: $('#rgName').value, registrationCode: $('#rgCode').value || undefined, serverUrl: serverUrl() }); await refreshState(); toast('Đã tạo tài khoản. Bước tiếp: đăng nhập Zalo bằng mã QR ở thanh trên.'); } catch (err) { setErr('#rgErr', err.message); } }); };
  $('#fgSend').onclick = async () => { setErr('#fgErr', ''); if (!$('#fgEmail').value.trim()) return setErr('#fgErr', 'Nhập email trước.'); await busy($('#fgSend'), 'Đang gửi…', async () => { try { const r = await api('/api/auth/forgot', { method: 'POST', body: { email: $('#fgEmail').value, serverUrl: serverUrl() } }); const h = $('#fgHint'); h.hidden = false; h.textContent = r.delivery === 'server-log' ? 'ℹ️ Máy chủ chưa cấu hình gửi email: mã đặt lại nằm trong nhật ký máy chủ — hãy hỏi quản trị viên rồi nhập ở bước 2.' : '✅ Đã gửi mã tới email (hiệu lực 30 phút). Nhập mã ở bước 2.'; $('#fgCode').focus(); } catch (err) { setErr('#fgErr', err.message); } }); };
  $('#formForgot').onsubmit = async (e) => { e.preventDefault(); setErr('#fgErr', ''); if (!$('#fgCode').value.trim()) return setErr('#fgErr', 'Nhập mã 8 ký tự đã nhận.'); await busy($('#fgBtn'), 'Đang đặt lại…', async () => { try { await api('/api/auth/reset', { method: 'POST', body: { email: $('#fgEmail').value, code: $('#fgCode').value, newPassword: $('#fgPassword').value, serverUrl: serverUrl() } }); toast('Đã đặt lại mật khẩu — hãy đăng nhập.'); $('#liEmail').value = $('#fgEmail').value; switchTab('login'); } catch (err) { setErr('#fgErr', err.message); } }); };
  $('#btnPing').onclick = async () => { $('#pingResult').textContent = 'Đang kiểm tra…'; try { const r = await api('/api/auth/ping?url=' + encodeURIComponent(serverUrl() || '')); $('#pingResult').textContent = '✅ Máy chủ trả lời (' + num(r.server?.users) + ' tài khoản' + (r.server?.smtp ? ', có gửi email' : ', chưa cấu hình email') + ').'; } catch (err) { $('#pingResult').textContent = '❌ ' + err.message; } };

  // ── Trạng thái chung ──────────────────────────────────────────────────────
  async function refreshState() {
    const s = await api('/api/state');
    Object.assign(state, { locked: s.locked, auth: s.auth, security: s.security, accounts: s.accounts, stats: s.stats || {}, settings: s.settings, paths: s.paths, platform: s.platform, workspace: s.workspace, automation: s.automation, suggestionsSummary: s.suggestions, power: s.power });
    if (s.locked) { showLogin(); return; }
    const justUnlocked = $('#appView').hidden;
    showApp();
    if (justUnlocked && !state.templates?.length) void loadTemplates();
    try { const sg = await api('/api/suggestions'); state.sugByKey = {}; for (const it of sg.items || []) { if (!it.threadId) continue; const k = (it.accountId || '') + '|' + it.threadId; (state.sugByKey[k] ||= []).push(it); } state.sugUnresolved = (sg.items || []).filter((i) => !i.threadId).length; } catch { /* giữ cũ */ }
    renderTop(); renderReencrypt(); renderPower();
    if ($('#dlgSettings').open) renderSettings();
  }
  function renderTop() {
    const list = visibleAccounts();
    const live = list.filter((a) => a.status === 'connected');
    const bad = list.find((a) => a.status === 'need_relogin');
    let zalo;
    if (!list.length) zalo = '<span class="pill">Chưa kết nối Zalo</span><button class="primary sm" data-act="qr">📱 Đăng nhập Zalo (QR)</button>';
    else if (bad) zalo = '<span class="pill bad">Zalo ' + esc(bad.displayName || '') + ': mất kết nối</span><button class="primary sm" data-act="qr">Quét mã QR</button>';
    else if (live.length) zalo = avatarHtml(live[0].avatarUrl, live[0].displayName, 'sm') + '<span class="pill ok">' + esc(live.map((a) => a.displayName || a.id).join(', ')) + ' · đang kết nối</span>';
    else { const p = list[0]; zalo = '<span class="pill warn">Zalo ' + esc(p.displayName || '') + ': ' + (STATUS[p.status]?.[1] || p.status) + '</span>' + (p.hasSession ? '<button class="primary sm" data-act="start" data-id="' + esc(p.id) + '">Kết nối</button>' : '<button class="primary sm" data-act="qr">Quét mã QR</button>'); }
    const s = state.stats || {};
    const job = list.map((a) => a.importJob).find((j) => j && j.running);
    $('#zaloStrip').innerHTML = zalo;
    $('#statChips').innerHTML = '<span class="chipstat" title="Hội thoại có tin chưa đọc">✉️ <b>' + num(s.unread_conversations) + '</b> chưa đọc</span><span class="chipstat">📩 ' + num(s.today) + ' tin hôm nay</span>' + (s.groups ? '<span class="chipstat">👥 ' + num(s.groups) + ' nhóm</span>' : '') +
      (job ? '<span class="chipstat">⏳ nhập lịch sử nhóm ' + job.done + '/' + job.total + '</span>' : '') +
      (state.suggestionsSummary?.count ? '<span class="chipstat" title="Gợi ý Claude ghi trong ket-qua/">💡 ' + num(state.suggestionsSummary.withReply ?? state.suggestionsSummary.resolved) + ' gợi ý' + (state.sugUnresolved ? ' (+' + state.sugUnresolved + ' chưa khớp)' : '') + '</span>' : '');
    $('#presetSel').value = state.settings.defaultPreset || 'today';
    const ws = state.workspace || {}; const au = state.automation;
    $('#wsLine').innerHTML = (ws.hasData && ws.status ? '📁 Dữ liệu cho Claude: <b>' + num(ws.status.conversations) + ' hội thoại, ' + num(ws.status.messages) + ' tin</b> — cập nhật ' + fmtClock(ws.status.updatedAt) : '📁 Chưa có dữ liệu cho Claude — bấm <b>Cập nhật dữ liệu cho Claude</b>.') +
      (au ? (au.quietAt ? ' · ⏱ sẽ cập nhật lúc ' + fmtClock(au.quietAt) : (au.quietMinutes ? ' · ⏱ tự cập nhật ' + au.quietMinutes + ' phút sau tin cuối' : '')) + (au.minutes ? ' · 🔄 tổng hợp lại mỗi ' + au.minutes + ' phút' + (au.nextRunAt ? ' (' + fmtClock(au.nextRunAt) + ')' : '') : '') : '') +
      ' · <button class="link" id="btnCopyPrompt2" title="Sao chép câu lệnh dán vào Claude Cowork">Sao chép câu lệnh</button>';
    $('#btnCopyPrompt2').onclick = copyPrompt;
  }
  function renderReencrypt() {
    const r = state.security?.reencrypt; const bar = $('#reencryptBar');
    if (r?.running) { bar.hidden = false; bar.innerHTML = '<div class="topbar-warn">🔐 Đang mã hoá lại dữ liệu bằng chuỗi mới' + (r.table ? ' — ' + r.table + ' ' + num(r.done) + '/' + num(r.total) : '') + '… Ứng dụng vẫn dùng được bình thường.</div>'; }
    else bar.hidden = true;
  }
  /** Thanh báo máy vừa ngủ: tin trong lúc ngủ có thể thiếu; nhắc bật chống ngủ nếu đang tắt. */
  function renderPower() {
    const p = state.power; const bar = $('#powerBar'); const g = p?.lastGap;
    if (g && Date.now() - g.to < 12 * 3600e3 && state.powerDismissed !== g.to) {
      const mins = Math.max(1, Math.round((g.to - g.from) / 60e3));
      bar.hidden = false;
      bar.innerHTML = '<div class="topbar-warn">💤 Máy đã ngủ ' + fmtClock(g.from) + '–' + fmtClock(g.to) + ' (' + mins + ' phút). Ứng dụng đã nối lại Zalo và xin tin bỏ lỡ; tin đến trong lúc ngủ có thể thiếu nếu Zalo không gửi bù — Claude được báo trong gói dữ liệu.' + (!p.keepAwake ? ' Bật <b>Giữ máy không ngủ</b> trong Cài đặt để tránh lặp lại.' : (p.supported && !p.active ? ' Chế độ chống ngủ chưa hoạt động — mở Cài đặt lưu lại tuỳ chọn.' : '')) + ' <button class="link" id="btnPowerDismiss">Đã hiểu</button></div>';
      $('#btnPowerDismiss').onclick = () => { state.powerDismissed = g.to; renderPower(); };
      return;
    }
    bar.hidden = true;
  }
  $('#zaloStrip').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    if (btn.dataset.act === 'qr') return openQr();
    if (btn.dataset.act === 'start') { btn.disabled = true; try { await api('/api/accounts/' + encodeURIComponent(btn.dataset.id) + '/start', { method: 'POST' }); await refreshState(); } catch (err) { toast(err.message); } finally { btn.disabled = false; } }
  });
  async function copyPrompt() { await copyText(PROMPT, 'Đã sao chép câu lệnh — dán vào Claude Cowork.'); }
  async function updateWorkspace(body, btn) {
    body.includeExcel = !!state.settings.includeExcel;
    await busy(btn, 'Đang chuẩn bị…', async () => {
      try { const r = await api('/api/workspace/update', { method: 'POST', body }); toast('Đã cập nhật ' + num(r.conversations) + ' hội thoại, ' + num(r.messages) + ' tin cho Claude.'); await refreshState(); }
      catch (err) { toast('Không cập nhật được: ' + err.message); }
    });
  }
  $('#btnWsUpdate').onclick = () => updateWorkspace({ preset: $('#presetSel').value }, $('#btnWsUpdate'));
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (!b) return; const p = b.dataset.open === 'workspace' ? state.paths.workspaceDir : state.paths.dataDir; api('/api/open', { method: 'POST', body: { path: p } }).catch((err) => toast(err.message)); });

  // ── Danh sách hội thoại: cuộn ảo (hàng cao cố định, tải theo trang) ────────
  const ROW_H = 64, PAGE = 100, OVERSCAN = 6; // ROW_H phải bằng chiều cao .conv trong CSS
  const vlist = {
    scroll: null, spacer: null, total: 0, rows: [], pages: new Set(), loading: new Set(), gen: 0,
    init() { this.scroll = $('#convScroll'); this.spacer = $('#convSpacer'); this.scroll.addEventListener('scroll', () => this.render()); new ResizeObserver(() => this.render()).observe(this.scroll); },
    params() { const p = new URLSearchParams({ includeGroups: 'true', limit: String(PAGE) }); if (state.q) p.set('q', state.q); if (state.filter === 'unread') p.set('unread', 'true'); if (state.filter === 'groups') p.set('groups', 'true'); return p; },
    reset() { this.gen++; this.rows = []; this.pages = new Set(); this.loading = new Set(); this.total = 0; this.scroll.scrollTop = 0; this.spacer.innerHTML = ''; this.spacer.style.height = '0px'; return this.loadPage(0).then(() => this.render()); },
    /** Tải lại các trang đã có (giữ vị trí cuộn) — dùng khi có tin mới/đổi trạng thái. */
    async refresh() { const gen = ++this.gen; const pages = [...this.pages]; if (!pages.length) return this.reset(); this.pages = new Set(); await Promise.all(pages.map((p) => this.loadPage(p, gen))); if (gen === this.gen) this.render(); },
    async loadPage(p, gen = this.gen) {
      if (this.pages.has(p) || this.loading.has(p)) return; this.loading.add(p);
      try {
        const q = this.params(); q.set('offset', String(p * PAGE));
        const r = await api('/api/conversations?' + q.toString());
        if (gen !== this.gen) return;
        this.total = r.total; for (let i = 0; i < r.rows.length; i++) this.rows[p * PAGE + i] = r.rows[i];
        this.pages.add(p); this.spacer.style.height = (this.total * ROW_H) + 'px';
        $('#convFoot').textContent = num(this.total) + ' hội thoại';
        this.render();
      } catch (err) { toast(err.message); } finally { this.loading.delete(p); }
    },
    render() {
      if (state.locked) return;
      const top = this.scroll.scrollTop, h = this.scroll.clientHeight;
      const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN), end = Math.min(this.total, Math.ceil((top + h) / ROW_H) + OVERSCAN);
      for (let p = Math.floor(start / PAGE); p <= Math.floor(Math.max(0, end - 1) / PAGE); p++) if (!this.pages.has(p)) void this.loadPage(p);
      let html = '';
      for (let i = start; i < end; i++) { const c = this.rows[i]; html += c ? convItem(c, i) : '<div class="conv skeleton" style="top:' + (i * ROW_H) + 'px"><div class="avatar"></div><div class="body"><div class="sk"></div><div class="sk short"></div></div></div>'; }
      if (!this.total && this.pages.size) html = '<div class="empty" style="position:relative"><div class="big">📭</div>' + (state.q || state.filter !== 'all' ? 'Không có hội thoại nào khớp.' : 'Chưa có hội thoại nào. Kết nối Zalo ở thanh trên; khi có tin nhắn mới, hội thoại sẽ hiện ở đây.') + '</div>';
      this.spacer.innerHTML = html;
    },
  };
  function convItem(c, i) {
    const key = c.account_id + '|' + c.thread_id;
    const sug = (state.sugByKey || {})[key]; const s = sug?.length ? (sug.find((x) => x.reply) || sug[0]) : null;
    const who = c.last_message_outbound ? 'Bạn' : (c.is_group ? (c.last_message_sender || '') : '');
    const unread = Number(c.unread_count || 0);
    return '<div class="conv ' + (state.selected === key ? 'active' : '') + (unread ? ' unread' : '') + '" data-key="' + esc(key) + '" style="top:' + (i * ROW_H) + 'px">' + avatarHtml(c.avatar_url, c.name) +
      '<div class="body"><div class="top"><span class="nm">' + (c.is_group ? '👥 ' : '') + esc(c.name || (c.is_group ? 'Nhóm ' : '') + c.thread_id) + '</span><span class="tm">' + fmtRel(c.last_message_at) + '</span></div>' +
      '<div class="bottom"><span class="pv">' + (who ? '<span class="faint">' + esc(who) + ':</span> ' : '') + esc(c.last_message_preview || '') + '</span>' +
      (unread ? '<span class="badge-unread">' + (unread > 99 ? '99+' : unread) + '</span>' : '') + (s ? '<span class="sugdot ' + (s.reply ? (s.kind === 'theo-doi' ? 'follow' : '') : 'none') + '" title="' + (s.reply ? 'Có gợi ý từ Claude' : 'Claude: không cần nhắn') + '">💡</span>' : '') + '</div></div></div>';
  }
  function setFilter(f) { state.filter = f; $$('.chip').forEach((b) => b.classList.toggle('active', b.dataset.filter === f)); }
  $$('.chip').forEach((b) => b.onclick = () => { setFilter(b.dataset.filter); vlist.reset(); });
  let searchTimer; $('#search').addEventListener('input', (e) => { state.q = e.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(() => vlist.reset(), 250); });
  $('#convScroll').addEventListener('click', (e) => { const it = e.target.closest('.conv'); if (!it || !it.dataset.key) return; openConversation(it.dataset.key); });

  // ── Tin nhắn: cuộn vô cực lên trên + cảm xúc + ảnh/sticker ───────────────
  const chat = { key: null, accountId: null, threadId: null, items: [], hasMore: false, loadingOlder: false, conv: null };
  const PAGE_MSG = 60;
  async function openConversation(key) {
    state.selected = key; chat.key = key; [chat.accountId, chat.threadId] = key.split('|'); chat.items = []; chat.hasMore = false;
    $$('.conv').forEach((x) => x.classList.toggle('active', x.dataset.key === key));
    const r = await api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/messages?limit=' + PAGE_MSG);
    if (chat.key !== key) return;
    chat.conv = r.conversation || {}; chat.items = r.messages; chat.hasMore = !!r.hasMore; chat.claude = r.claude ?? null;
    renderHead(); renderMessages(true); renderSuggestion(chat.accountId, chat.threadId); renderSideClaude(); renderComposer();
    api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/read', { method: 'POST' }).then(() => { const row = vlist.rows.find((c) => c && c.account_id === chat.accountId && c.thread_id === chat.threadId); if (row) { row.unread_count = 0; vlist.render(); } refreshState(); }).catch(() => {});
  }
  function renderHead() {
    const c = chat.conv || {};
    $('#chatName').textContent = c.name || chat.threadId;
    $('#chatMeta').textContent = c.is_group ? 'Nhóm · ' + num(c.message_count) + ' tin nhắn' : (c.phone ? c.phone + ' · ' : '') + num(c.message_count) + ' tin nhắn';
    $('#chatAvatar').outerHTML = avatarHtml(c.avatar_url, c.name).replace('class="avatar', 'id="chatAvatar" class="avatar');
    $('#chatExportBtn').hidden = false;
  }
  function attHtml(a) {
    const url = a.url ? esc(a.url) : '';
    // Ảnh/sticker lỗi tải (link Zalo hết hạn, không có mạng) → đổi sang chip có tên + liên kết, không để ô trống.
    const onErr = (label) => ' onerror="this.parentElement.outerHTML=\x27<a class=&quot;att-chip&quot; href=&quot;' + url + '&quot; target=&quot;_blank&quot; rel=&quot;noopener&quot;>' + label + ' (không tải được — mở liên kết)</a>\x27"';
    if (a.type === 'sticker') return url ? '<span><img class="sticker" src="' + url + '" alt="Sticker" loading="lazy"' + onErr('😊 Sticker') + '></span>' : '<span class="att-chip">😊 Sticker</span>';
    if (a.type === 'image' || a.type === 'gif') return url ? '<a href="' + url + '" target="_blank" rel="noopener"><img class="att-img" src="' + url + '" alt="' + esc(a.name || 'Ảnh') + '" loading="lazy"' + onErr((a.type === 'gif' ? '🎞 ' : '🖼 ') + esc(a.name || 'Ảnh')) + '></a>' : '<span class="att-chip">🖼 ' + esc(a.name || 'Ảnh') + '</span>';
    if (a.type === 'video') return url ? '<video class="att-video" controls preload="metadata"' + (a.thumb ? ' poster="' + esc(a.thumb) + '"' : '') + ' src="' + url + '"></video>' : '<span class="att-chip">🎬 Video</span>';
    if (a.type === 'audio') return url ? '<audio class="att-audio" controls preload="none" src="' + url + '"></audio>' : '<span class="att-chip">🎤 Ghi âm</span>';
    if (a.type === 'file') return url ? '<a class="att-chip file" href="' + url + '" target="_blank" rel="noopener">📎 ' + esc(a.name || 'Tệp') + '</a>' : '<span class="att-chip">📎 ' + esc(a.name || 'Tệp') + '</span>';
    if (a.type === 'link') return url ? '<a class="att-chip" href="' + url + '" target="_blank" rel="noopener">🔗 ' + esc(a.name || url) + '</a>' : '';
    return url ? '<a class="att-chip" href="' + url + '" target="_blank" rel="noopener">📄 ' + esc(a.name || a.type) + '</a>' : '<span class="att-chip">' + esc(a.name || a.type) + '</span>';
  }
  function bubble(m) {
    const c = chat.conv || {};
    const who = m.is_outbound ? 'Bạn' : esc(m.sender_name || c.name || '');
    const atts = (m.attachments || []);
    const mediaOnly = !m.text && atts.length && atts.every((a) => ['sticker', 'image', 'gif'].includes(a.type) && a.url);
    const reacts = (m.reactions || []).length ? '<div class="reacts">' + m.reactions.map((r) => '<span class="react ' + (r.mine ? 'mine' : '') + '">' + esc(emo(r.icon)) + (r.count > 1 ? ' ' + r.count : '') + '</span>').join('') + '</div>' : '';
    return '<div class="msg ' + (m.is_outbound ? 'out' : 'in') + '" data-id="' + m.id + '"><div class="bubble' + (mediaOnly ? ' media' : '') + (m.recalled ? ' recalled' : '') + '">' +
      (c.is_group && !m.is_outbound ? '<div class="meta">' + who + '</div>' : '') +
      (m.quote_text ? '<div class="quote">' + esc(m.quote_text) + '</div>' : '') +
      (m.recalled ? '<i>Tin nhắn đã được thu hồi</i>' : (/^sendBubbleMessage\b/.test(m.text || '') ? '📞 <i>' + esc((m.text || '').replace(/^sendBubbleMessage\s*[—-]?\s*/, '') || 'Cuộc gọi') + '</i>' : esc(m.text || ''))) +
      (atts.length ? '<div class="atts">' + atts.map(attHtml).join('') + '</div>' : '') +
      '<div class="time">' + fmtClock(m.event_time) + '</div></div>' + reacts + '</div>';
  }
  function renderMessages(scrollBottom) {
    const box = $('#msgs'), list = $('#msgsList');
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    let lastDay = '', html = '';
    for (const m of chat.items) { const d = dayKey(m.event_time); if (d !== lastDay) { html += '<div class="day-sep">' + fmtDay(m.event_time) + '</div>'; lastDay = d; } html += bubble(m); }
    list.innerHTML = html || '<div class="empty">Chưa có tin nhắn.</div>';
    $('#msgsTop').textContent = chat.hasMore ? 'Cuộn lên để xem tin cũ hơn' : (chat.items.length ? 'Đầu hội thoại đã lưu' : '');
    if (scrollBottom) box.scrollTop = box.scrollHeight; else box.scrollTop = box.scrollHeight - prevH + prevTop;
  }
  async function loadOlder() {
    if (!chat.key || !chat.hasMore || chat.loadingOlder || !chat.items.length) return;
    chat.loadingOlder = true; const key = chat.key;
    try {
      const oldest = chat.items[0].event_time;
      const r = await api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/messages?limit=' + PAGE_MSG + '&before=' + oldest);
      if (chat.key !== key) return;
      const seen = new Set(chat.items.map((m) => m.id));
      chat.items = [...r.messages.filter((m) => !seen.has(m.id)), ...chat.items]; chat.hasMore = !!r.hasMore;
      renderMessages(false);
    } catch (err) { toast(err.message); } finally { chat.loadingOlder = false; }
  }
  $('#msgs').addEventListener('scroll', () => { if ($('#msgs').scrollTop < 120) loadOlder(); });
  /** Có tin mới/cảm xúc mới ở hội thoại đang mở: lấy phần mới nhất, ghép vào (giữ vị trí nếu đang đọc tin cũ). */
  async function refreshOpenChat() {
    if (!chat.key) return; const key = chat.key;
    const r = await api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/messages?limit=' + PAGE_MSG);
    if (chat.key !== key) return;
    const box = $('#msgs'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const byId = new Map(chat.items.map((m) => [m.id, m]));
    for (const m of r.messages) byId.set(m.id, m);
    chat.items = [...byId.values()].sort((a, b) => a.event_time - b.event_time || a.id - b.id);
    chat.conv = r.conversation || chat.conv; if (r.claude !== undefined) chat.claude = r.claude; renderHead(); renderMessages(atBottom); renderSuggestion(chat.accountId, chat.threadId); renderSideClaude();
    api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/read', { method: 'POST' }).catch(() => {});
  }
  function renderComposer() {
    const acc = state.accounts.find((a) => a.id === chat.accountId);
    const comp = $('#composer'); comp.hidden = false;
    const canSend = acc?.status === 'connected';
    $('#btnSend').disabled = !canSend; $('#composeText').disabled = !canSend;
    $('#composeText').placeholder = canSend ? 'Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)' : 'Zalo chưa kết nối — kết nối ở thanh trên để gửi tin';
  }
  $('#chatExportBtn').onclick = () => { if (!chat.key) return; updateWorkspace({ preset: 'one', accountIds: [chat.accountId], threadIds: [chat.threadId] }, $('#chatExportBtn')); };

  // ── Gợi ý từ Claude ───────────────────────────────────────────────────────
  const KIND = { 'tra-loi': ['', 'Trả lời'], 'theo-doi': ['follow', 'Nhắn tiếp'], 'nhom': ['', 'Nhóm'], 'khong-can': ['none', 'Không cần nhắn'] };
  function renderSuggestion(accountId, threadId) {
    const list = (state.sugByKey || {})[accountId + '|' + threadId] || [];
    const card = $('#sugCard');
    if (!list.length) { card.hidden = true; card.innerHTML = ''; card.className = 'sug-card'; return; }
    const it = list.find((x) => x.reply) || list[0];
    const [kcls, klabel] = KIND[it.kind] || KIND['tra-loi'];
    card.hidden = false; card.className = 'sug-card ' + kcls;
    const prio = it.priority ? '<span class="prio ' + (it.priority === 'P1' ? 'p1' : it.priority === 'P3' ? 'p3' : '') + '">' + esc(it.priority) + '</span>' : '';
    const head = '<div class="head"><span class="ttl">💡 Gợi ý từ Claude</span><span class="kind">' + klabel + '</span>' + prio + '<span class="meta">' + fmtTime(it.writtenAt) + (list.length > 1 ? ' · ' + list.length + ' gợi ý' : '') + '</span>' +
      (it.reply ? '<span class="acts"><button class="primary sm" id="btnUseSug">✍️ Dùng gợi ý này</button><button class="sm" id="btnCopySug">Sao chép</button></span>' : '') + '</div>';
    const warn = it.hasNewer ? '<div class="warnnew">⚠️ Có tin mới sau khi Claude viết gợi ý — đọc lại hội thoại trước khi gửi.</div>' : '';
    if (!it.reply) { card.innerHTML = head + warn + '<div class="reason">' + esc(it.reason || 'Claude đánh giá lúc này không cần nhắn gì thêm.') + '</div>' + (it.summary ? '<div class="ctx"><b>Bối cảnh:</b> ' + esc(it.summary) + '</div>' : ''); return; }
    card.innerHTML = head + warn + (it.summary ? '<div class="ctx"><b>Bối cảnh:</b> ' + esc(it.summary) + '</div>' : '') + '<div class="reply">' + esc(it.reply) + '</div>' +
      ((it.notes || it.nextAction) ? '<details class="more"><summary>Ghi chú của Claude' + (it.notes && /CẦN XÁC NHẬN/i.test(it.notes) ? ' · có điểm cần xác nhận' : '') + '</summary><div>' + esc([it.notes, it.nextAction ? 'Hành động tiếp: ' + it.nextAction : ''].filter(Boolean).join('\n')) + '</div></details>' : '');
    $('#btnUseSug').onclick = () => { const t = $('#composeText'); t.value = it.reply; t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
    $('#btnCopySug').onclick = async () => { await copyText(it.reply, 'Đã sao chép gợi ý.'); };
  }
  async function sendCurrent() {
    if (!chat.key) return;
    const t = $('#composeText'); const text = t.value.trim(); if (!text) return;
    await busy($('#btnSend'), 'Đang gửi…', async () => {
      try { await api('/api/conversations/' + encodeURIComponent(chat.accountId) + '/' + encodeURIComponent(chat.threadId) + '/send', { method: 'POST', body: { text } }); t.value = ''; await refreshOpenChat(); vlist.refresh(); }
      catch (err) { toast('Không gửi được: ' + err.message); }
    });
  }
  $('#btnSend').onclick = sendCurrent;
  $('#composeText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendCurrent(); } });

  // ── Cột trợ lý: tóm tắt của Claude cho hội thoại đang mở + tin nhắn mẫu ───
  const prefill = (text) => { if (!chat.key) { toast('Chọn một hội thoại trước.'); return; } const t = $('#composeText'); t.value = text; t.focus(); t.setSelectionRange(t.value.length, t.value.length); };
  function renderSideClaude() {
    const box = $('#sideClaude'); const cl = chat.claude; const sugs = chat.key ? ((state.sugByKey || {})[chat.key] || []) : [];
    if (!chat.key) { box.innerHTML = '<div class="empty small">Chọn một hội thoại để xem tóm tắt và gợi ý của Claude.</div>'; $('#sideMeta').textContent = ''; return; }
    $('#sideMeta').textContent = cl ? 'Báo cáo ' + fmtDate(cl.date) + ' · ' + fmtClock(cl.generatedAt) : (sugs.length ? 'Gợi ý ' + fmtTime(sugs[0].writtenAt) : '');
    if (!cl) { box.innerHTML = '<div class="sec-head"><b>📝 Tóm tắt của Claude</b></div><div class="sc-sum faint">Chưa có tóm tắt cho hội thoại này trong báo cáo ngày. Claude cập nhật vài phút sau tin nhắn mới (khi Claude Cowork đang mở).</div>'; return; }
    const [scls, slabel] = cl.sentiment ? (SENT[cl.sentiment] || ['', cl.sentiment]) : ['', ''];
    const lv = report.level; const nT = (cl.tasksForYou || []).length, nQ = (cl.openQuestions || []).length;
    const head = '<div class="sec-head"><b>📝 Tóm tắt của Claude</b>' + (cl.relation ? '<span class="pill" title="' + esc(cl.relationNote || '') + '">' + esc(REL[cl.relation] || cl.relation) + '</span>' : '') + (slabel ? '<span class="pill ' + scls + '">' + slabel + '</span>' : '') + '<span class="grow"></span>' + segHtml('sideLevel') + '<button class="link" id="btnSideReport">Mở báo cáo</button></div>';
    let body;
    if (lv === 'brief') body = '<div class="sc-sum">' + esc(briefOf(cl)) + (nT || nQ ? ' <span class="faint small">· ' + [nT ? nT + ' việc của Bạn' : '', nQ ? nQ + ' câu chưa trả lời' : ''].filter(Boolean).join(' · ') + '</span>' : '') + '</div>';
    else body = (cl.summary ? '<div class="sc-sum">' + paras(cl.summary) + '</div>' : '') +
      (lv === 'full' && (cl.timeline || []).length ? '<ul class="rp-tl">' + cl.timeline.map((t) => '<li>' + (t.time ? '<b>' + esc(t.time) + '</b> ' : '') + esc(t.what) + '</li>').join('') + '</ul>' : '') +
      (lv === 'full' && (cl.keyFacts || []).length ? '<div class="rp-list facts"><b>Thông tin đáng nhớ:</b><ul>' + cl.keyFacts.map((k) => '<li>' + esc(k) + '</li>').join('') + '</ul></div>' : '') +
      ((cl.decisions || []).length ? '<div class="rp-list"><b>Đã chốt:</b> ' + cl.decisions.map(esc).join(' · ') + '</div>' : '') +
      ((cl.tasksForYou || []).length ? '<div class="rp-list todo"><b>Việc của Bạn:</b><ul>' + cl.tasksForYou.map((k) => '<li>' + esc(k) + '</li>').join('') + '</ul></div>' : '') +
      ((cl.openQuestions || []).length ? '<div class="rp-list ask"><b>Chưa trả lời:</b><ul>' + cl.openQuestions.map((k) => '<li>' + esc(k) + '</li>').join('') + '</ul></div>' : '') +
      (lv === 'full' && (cl.topics || []).length ? '<div class="rp-tags">' + cl.topics.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '');
    box.innerHTML = head + body;
    $('#btnSideReport').onclick = openReport;
  }
  $('#sideClaude').addEventListener('click', (e) => { const b = e.target.closest('button[data-level]'); if (b) setLevel(b.dataset.level); });
  // Ẩn/hiện cột trợ lý — nhớ lựa chọn; màn hẹp (< 1000px) mặc định ẩn.
  const SIDE_KEY = 'zca.sideHidden';
  function setSide(hidden) { $('.cols').classList.toggle('noside', hidden); try { localStorage.setItem(SIDE_KEY, hidden ? '1' : '0'); } catch { /* bỏ qua */ } $('#btnSideToggle').classList.toggle('active', !hidden); applyCols(); }
  // ── Kéo đổi độ rộng cột 1 và 3 (cột giữa nhận phần còn lại, tối thiểu 360px); nhớ theo máy; bấm đôi thanh kéo = mặc định.
  const COLS_KEY = 'zca.cols', COL_DEF = { c1: 280, c3: 340 }; const colw = { ...COL_DEF };
  try { const saved = JSON.parse(localStorage.getItem(COLS_KEY) || '{}'); if (Number.isFinite(saved.c1)) colw.c1 = saved.c1; if (Number.isFinite(saved.c3)) colw.c3 = saved.c3; } catch { /* bỏ qua */ }
  function applyCols() {
    const el = $('.cols'); const total = el.clientWidth || window.innerWidth; const side = !el.classList.contains('noside'); const minChat = 360, g = 12;
    colw.c1 = Math.round(Math.max(240, Math.min(colw.c1, 520))); colw.c3 = Math.round(Math.max(260, Math.min(colw.c3, 640)));
    if (side && colw.c1 + colw.c3 + minChat + g > total) colw.c3 = Math.max(260, total - colw.c1 - minChat - g);
    if (side && colw.c1 + colw.c3 + minChat + g > total) colw.c1 = Math.max(240, total - colw.c3 - minChat - g);
    el.style.setProperty('--c1', colw.c1 + 'px'); el.style.setProperty('--c3', colw.c3 + 'px');
    if (vlist.scroll) vlist.render();
  }
  const saveCols = () => { try { localStorage.setItem(COLS_KEY, JSON.stringify(colw)); } catch { /* bỏ qua */ } };
  $$('.gutter').forEach((gt) => {
    gt.addEventListener('mousedown', (e) => {
      e.preventDefault(); const which = gt.dataset.gutter; const startX = e.clientX; const start = { ...colw };
      gt.classList.add('active'); document.body.classList.add('resizing');
      const move = (ev) => { const dx = ev.clientX - startX; if (which === '1') colw.c1 = start.c1 + dx; else colw.c3 = start.c3 - dx; applyCols(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); gt.classList.remove('active'); document.body.classList.remove('resizing'); saveCols(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    gt.addEventListener('dblclick', () => { if (gt.dataset.gutter === '1') colw.c1 = COL_DEF.c1; else colw.c3 = COL_DEF.c3; applyCols(); saveCols(); });
  });
  window.addEventListener('resize', () => applyCols());
  function initSide() { let v = null; try { v = localStorage.getItem(SIDE_KEY); } catch { /* bỏ qua */ } setSide(v === null ? window.innerWidth < 1000 : v === '1'); }
  $('#btnSideToggle').onclick = () => setSide(!$('.cols').classList.contains('noside'));
  $('#btnSideHide').onclick = () => setSide(true);
  // Tin nhắn mẫu
  state.templates = []; let tplEditing = null;
  const applyTpl = (text) => text.replace(/\[tên\]/gi, () => (chat.conv && !chat.conv.is_group && chat.conv.name) ? chat.conv.name : '[tên]');
  async function loadTemplates() { if (state.locked) return; try { const r = await api('/api/templates'); state.templates = r.items || []; } catch (err) { state.templates = []; if (err.status !== 423) toast('Không tải được tin nhắn mẫu: ' + err.message); } renderTemplates(); }
  function renderTemplates() {
    const list = $('#tplList');
    if (!state.templates.length) { list.innerHTML = '<div class="empty small">Chưa có mẫu nào — bấm ＋ Thêm.</div>'; return; }
    list.innerHTML = state.templates.map((t, i) => '<div class="tpl" data-i="' + i + '"><div class="t" data-use="' + i + '" title="Điền vào ô soạn"><b>' + esc(t.title) + '</b><span>' + esc(t.text) + '</span></div><button class="sm icon" data-edit="' + i + '" title="Sửa mẫu">✎</button></div>').join('');
  }
  $('#tplList').addEventListener('click', (e) => {
    const u = e.target.closest('[data-use]'); const ed = e.target.closest('[data-edit]');
    if (ed) { openTplDialog(Number(ed.dataset.edit)); return; }
    if (u) { const t = state.templates[Number(u.dataset.use)]; if (t) prefill(applyTpl(t.text)); }
  });
  function openTplDialog(i) {
    tplEditing = Number.isInteger(i) ? i : null; const t = tplEditing !== null ? state.templates[tplEditing] : null;
    $('#tplDlgTitle').textContent = t ? 'Sửa tin nhắn mẫu' : 'Thêm tin nhắn mẫu'; $('#tplTitle').value = t?.title || ''; $('#tplText').value = t?.text || ''; $('#btnTplDelete').hidden = !t; $('#tplMsg').textContent = '';
    $('#dlgTemplate').showModal(); setTimeout(() => $('#tplTitle').focus(), 50);
  }
  async function saveTemplates(items, okMsg) { try { const r = await api('/api/templates', { method: 'POST', body: { items } }); state.templates = r.items || items; renderTemplates(); $('#dlgTemplate').close(); toast(okMsg); } catch (err) { $('#tplMsg').textContent = '❌ ' + err.message; } }
  $('#btnTplAdd').onclick = () => openTplDialog(null);
  $('#btnTplSave').onclick = () => { const title = $('#tplTitle').value.trim(), text = $('#tplText').value.trim(); if (!title || !text) { $('#tplMsg').textContent = 'Cần cả tên mẫu và nội dung.'; return; } const items = state.templates.slice(); if (tplEditing !== null) items[tplEditing] = { ...items[tplEditing], title, text }; else items.push({ id: 'tpl-' + Date.now(), title, text }); saveTemplates(items, 'Đã lưu tin nhắn mẫu.'); };
  $('#btnTplDelete').onclick = () => { if (tplEditing === null) return; if (!confirm('Xoá mẫu này?')) return; saveTemplates(state.templates.filter((_, i) => i !== tplEditing), 'Đã xoá mẫu.'); };

  // ── Cài đặt (hộp thoại) ───────────────────────────────────────────────────
  function renderSettings() {
    const u = state.auth.user || {};
    const local = state.auth.mode === 'local';
    $('#settingsSub').textContent = local ? 'Chế độ dùng thử — không máy chủ' : (u.email ? 'Đăng nhập: ' + u.email : '');
    $('#cpDetails').hidden = local;
    $('#accountKv').innerHTML = local
      ? '<div>Chế độ</div><div><span class="pill warn">Dùng thử — không máy chủ</span> ' + esc(u.name || '') + '</div><div>Lưu ý</div><div class="small muted">Chuỗi mã hoá do máy này tự tạo, không sao lưu ở đâu khác: dữ liệu chỉ đọc được trên máy này. Đăng xuất sẽ XOÁ dữ liệu thử. Muốn dùng lâu dài, đăng xuất rồi đăng ký tài khoản trên máy chủ.</div>'
      : '<div>Email</div><div><b>' + esc(u.email || '') + '</b>' + (u.name ? ' · ' + esc(u.name) : '') + '</div><div>Máy chủ</div><div>' + esc(state.auth.serverUrl || '') + (state.auth.loggedIn ? ' <span class="pill ok">Còn phiên</span>' : ' <span class="pill bad">Hết phiên — cần đăng nhập lại</span>') + '</div>' + (state.auth.lastServerError ? '<div>Lần gần nhất</div><div class="small" style="color:var(--bad)">' + esc(state.auth.lastServerError) + '</div>' : '');
    const sec = state.security || {}; const r = sec.reencrypt;
    $('#securityKv').innerHTML = '<div>Chuỗi mã hoá</div><div>Phiên bản <b>' + num(sec.keyVersion) + '</b> · đang giữ ' + num(sec.keyCount) + ' phiên bản để giải mã dữ liệu cũ</div><div>Trạng thái</div><div>' + (r?.running ? '🔐 Đang mã hoá lại: ' + (r.table || '') + ' ' + num(r.done) + '/' + num(r.total) : (sec.pending ? '⚠️ ' + num(sec.pending) + ' dòng chưa ở phiên bản hiện tại' : '✅ Toàn bộ dữ liệu ở phiên bản hiện tại')) + (r && !r.running && r.finishedAt ? ' · lần gần nhất ' + fmtTime(r.finishedAt) + (r.error ? ' — lỗi: ' + esc(r.error) : '') : '') + '</div>';
    const list = visibleAccounts();
    $('#accountRows').innerHTML = list.length ? list.map((a) => {
      const [cls, label] = STATUS[a.status] || ['', a.status];
      const needQr = a.status === 'need_relogin' || a.status === 'logged_out' || (a.status === 'disconnected' && !a.hasSession);
      const j = a.importJob;
      return '<div class="acc-row" data-id="' + esc(a.id) + '">' + avatarHtml(a.avatarUrl, a.displayName, 'lg') + '<div class="who"><b>' + esc(a.displayName || a.id) + '</b><span class="muted">' + esc(a.phone || '') + '</span><br><span class="pill ' + cls + '">' + label + '</span>' + (a.lastError && cls === 'bad' ? '<div class="small" style="color:var(--bad)">' + esc(a.lastError).slice(0, 140) + '</div>' : '') + '</div>' +
        (j ? '<div class="progress" style="flex-basis:100%">' + (j.running ? '⏳ Đang nhập lịch sử nhóm: ' + j.done + '/' + j.total + ' nhóm, ' + num(j.newMessages) + ' tin mới…' : j.error ? '⚠️ Nhập lịch sử nhóm dừng: ' + esc(j.error) : (j.newMessages === 0 && j.total > 0 ? 'ℹ️ Đã hỏi ' + j.total + ' nhóm: không lấy thêm được tin cũ — Zalo không cấp lịch sử cũ cho phiên web (' + (j.filtered || 0) + ' nhóm bị lọc). Tin nhóm vẫn được lưu từ lúc kết nối. (' + fmtTime(j.finishedAt) + ')' : '✅ Đã nhập lịch sử ' + j.done + ' nhóm, ' + num(j.newMessages) + ' tin mới (' + fmtTime(j.finishedAt) + ')')) + '</div>' : '') +
        '<div class="btns">' + (needQr ? '<button class="primary" data-act="relogin">Quét mã QR</button>' : '') + (a.status === 'disconnected' && a.hasSession ? '<button class="primary" data-act="start">Kết nối</button>' : '') + (['connected', 'reconnecting', 'connecting'].includes(a.status) ? '<button data-act="stop">Tạm dừng</button>' : '') + (a.status === 'connected' ? '<button data-act="import-groups" ' + (j?.running ? 'disabled' : '') + '>👥 Nhập lịch sử nhóm</button><button data-act="sync-contacts">Đồng bộ danh bạ</button><button data-act="sync-old">Lấy tin bỏ lỡ</button>' : '') + '<button class="danger" data-act="logout">Đăng xuất Zalo</button></div></div>';
    }).join('') : '<p class="muted">Chưa đăng nhập Zalo nào. Bấm "Đăng nhập Zalo (QR)".</p>';
    const ws = state.workspace || {};
    $('#wsKv').innerHTML = '<div>Đường dẫn</div><div><code>' + esc(ws.root || state.paths.workspaceDir || '') + '</code></div><div>Dữ liệu hiện có</div><div>' + (ws.hasData && ws.status ? num(ws.status.conversations) + ' hội thoại, ' + num(ws.status.messages) + ' tin — ' + fmtTime(ws.status.updatedAt) : 'chưa có') + '</div><div>Câu lệnh cho Claude</div><div><code>' + esc(PROMPT) + '</code></div>';
    const s = state.settings;
    $('#setExcel').checked = !!s.includeExcel; $('#setPreset').value = s.defaultPreset || 'today'; $('#setAutoMinutes').value = s.autoUpdateMinutes ?? 60; $('#setQuietMinutes').value = s.quietMinutes ?? 3;
    $('#setGroups').checked = !!s.includeGroups; $('#setSyncOld').checked = s.syncOldOnConnect !== false;
    $('#setWaitingHours').value = s.waitingHours ?? 2; $('#setGroupCount').value = s.groupHistoryCount ?? 300;
    const supportsAuto = state.platform && state.platform.autoStart !== null && state.platform.autoStart !== undefined;
    $('#setAutoStartRow').hidden = !supportsAuto; if (supportsAuto) $('#setAutoStart').checked = !!state.platform.autoStart;
    const pw = state.power; $('#setKeepAwakeRow').hidden = !pw?.supported; $('#setKeepAwake').checked = !!s.keepAwake;
    $('#keepAwakeState').textContent = pw?.supported ? (pw.active ? '· Đang hoạt động.' : (s.keepAwake ? '· Chưa kích hoạt — lưu tuỳ chọn để bật.' : '· Đang tắt.')) : '';
    $('#pathData').textContent = state.paths.dataDir || '';
    $('#verText').textContent = state.platform?.version ? '· phiên bản ' + state.platform.version : '';
  }
  function openSettings() { renderSettings(); $('#dlgSettings').showModal(); }
  $('#btnSettings').onclick = openSettings;
  $('#accountRows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.acc-row').dataset.id; const act = btn.dataset.act;
    try {
      if (act === 'relogin') return openQr();
      if (act === 'logout' && !confirm('Đăng xuất tài khoản Zalo này khỏi ứng dụng?\nTin nhắn đã lưu vẫn được giữ. Muốn dùng lại phải quét mã QR.')) return;
      btn.disabled = true;
      const r = await api('/api/accounts/' + encodeURIComponent(id) + '/' + act, { method: 'POST' });
      if (act === 'sync-contacts') toast('Đã đồng bộ ' + num(r.count) + ' bạn bè.');
      if (act === 'sync-old') toast('Đã yêu cầu Zalo gửi lại tin bỏ lỡ.');
      if (act === 'import-groups') toast('Bắt đầu nhập lịch sử nhóm — chạy nền.');
      await refreshState();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
  $('#btnAddAccount').onclick = openQr;
  $('#btnSettingsSave').onclick = async () => {
    try {
      const body = { includeGroups: $('#setGroups').checked, syncOldOnConnect: $('#setSyncOld').checked, waitingHours: Number($('#setWaitingHours').value), groupHistoryCount: Number($('#setGroupCount').value), includeExcel: $('#setExcel').checked, defaultPreset: $('#setPreset').value, autoUpdateMinutes: Number($('#setAutoMinutes').value), quietMinutes: Number($('#setQuietMinutes').value), keepAwake: $('#setKeepAwake').checked };
      if (!$('#setAutoStartRow').hidden) body.autoStart = $('#setAutoStart').checked;
      await api('/api/settings', { method: 'POST', body }); toast('Đã lưu tuỳ chọn.'); await refreshState();
    } catch (err) { toast(err.message); }
  };
  $('#btnLogoutApp').onclick = async () => { const msg = state.auth.mode === 'local' ? 'Thoát chế độ dùng thử?\nTOÀN BỘ dữ liệu thử trên máy này (tin nhắn, hội thoại) sẽ bị XOÁ vì chuỗi mã hoá không được lưu ở đâu khác. Phiên Zalo cần quét QR lại.' : 'Đăng xuất khỏi ứng dụng?\nZalo sẽ ngừng lưu tin cho tới khi đăng nhập lại. Dữ liệu trên máy vẫn được giữ (đã mã hoá).'; if (!confirm(msg)) return; try { $('#dlgSettings').close(); await api('/api/auth/logout', { method: 'POST' }); await refreshState(); } catch (err) { toast(err.message); } };
  $('#cpBtn').onclick = async () => { $('#cpMsg').textContent = ''; try { await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: $('#cpCurrent').value, newPassword: $('#cpNew').value } }); $('#cpMsg').textContent = '✅ Đã đổi mật khẩu.'; $('#cpCurrent').value = ''; $('#cpNew').value = ''; } catch (err) { $('#cpMsg').textContent = '❌ ' + err.message; } };
  $('#btnRotate').onclick = async () => { if (!confirm('Đổi chuỗi mã hoá?\nMáy chủ sẽ cấp chuỗi mới và ứng dụng mã hoá lại TOÀN BỘ dữ liệu trên máy (chạy nền). Máy khác dùng cùng tài khoản sẽ tự lấy chuỗi mới khi mở.')) return; await busy($('#btnRotate'), 'Đang đổi…', async () => { try { const r = await api('/api/security/rotate-key', { method: 'POST' }); toast('Đã đổi sang phiên bản ' + r.version + ' — đang mã hoá lại.'); await refreshState(); } catch (err) { toast(err.message); } }); };
  $('#btnReencrypt').onclick = async () => { try { await api('/api/security/reencrypt', { method: 'POST' }); toast('Đã bắt đầu mã hoá lại phần còn thiếu.'); } catch (err) { toast(err.message); } };
  $('#btnCopyWs').onclick = async () => { await copyText(state.paths.workspaceDir || '', 'Đã sao chép đường dẫn.'); };
  $('#btnCopyPrompt').onclick = copyPrompt;
  $('#btnClearWs').onclick = async () => { if (!confirm('Xoá toàn bộ nội dung du-lieu/ trong thư mục Claude? Cơ sở dữ liệu gốc không bị ảnh hưởng.')) return; try { await api('/api/workspace/clear', { method: 'POST' }); toast('Đã xoá dữ liệu đã chuẩn bị.'); await refreshState(); } catch (err) { toast(err.message); } };
  async function loadLogs() { try { const rows = await api('/api/logs?n=150'); $('#logbox').textContent = rows.map((r) => '[' + new Date(r.ts).toLocaleTimeString('vi-VN') + '] ' + r.level.toUpperCase() + ' ' + r.message).join('\n'); } catch { /* bỏ qua */ } }
  $('#logDetails').addEventListener('toggle', (e) => { if (e.target.open) loadLogs(); });

  // ── Báo cáo ngày ─────────────────────────────────────────────────────────
  const REL = { 'khach-hang': 'Khách hàng', 'dong-nghiep': 'Đồng nghiệp', 'doi-tac': 'Đối tác', 'ban-be': 'Bạn bè', 'nhom': 'Nhóm', 'khac': 'Khác' };
  const SENT = { 'binh-thuong': ['', 'Bình thường'], 'trung-tinh': ['', 'Bình thường'], 'tich-cuc': ['ok', 'Tích cực'], 'lo-lang': ['warn', 'Lo lắng'], 'khong-hai-long': ['bad', 'Không hài lòng'], 'khan': ['bad', 'Khẩn'] };
  const report = { dates: [], today: null, date: null, data: null, level: 'full' };
  try { const lv = localStorage.getItem('zca.reportLevel'); if (['full', 'medium', 'brief'].includes(lv)) report.level = lv; } catch { /* bỏ qua */ }
  const LEVEL_LABEL = { full: 'Chi tiết — mọi mục: diễn biến, mốc chính, thông tin đáng nhớ, đã chốt, việc, câu hỏi', medium: 'Vừa đủ — diễn biến + đã chốt + việc của Bạn + câu chưa trả lời', brief: 'Cô đọng — mỗi hội thoại 1–2 câu' };
  const paras = (t) => esc(t).split(/\n\s*\n/).map((p) => '<p>' + p.replace(/\n+/g, '<br>') + '</p>').join('');
  const firstSentences = (t, n) => { const m = String(t || '').replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+(\s|$)/g); return m ? m.slice(0, n).join('').trim() : String(t || ''); };
  const briefOf = (cl) => cl?.brief || firstSentences(cl?.summary, 2);
  const LEVEL_SHORT = { full: 'Chi tiết', medium: 'Vừa đủ', brief: 'Cô đọng' };
  function segHtml(id) { return '<div class="seg sm" id="' + id + '">' + ['full', 'medium', 'brief'].map((l) => '<button type="button" data-level="' + l + '" class="' + (report.level === l ? 'active' : '') + '" title="' + esc(LEVEL_LABEL[l]) + '">' + LEVEL_SHORT[l] + '</button>').join('') + '</div>'; }
  function renderLevelSeg() { $$('#rpLevel button').forEach((b) => { b.classList.toggle('active', b.dataset.level === report.level); b.title = LEVEL_LABEL[b.dataset.level]; }); }
  /** Một mức dùng chung cho hộp Báo cáo và cột trợ lý; nhớ theo máy. */
  function setLevel(l) { if (!['full', 'medium', 'brief'].includes(l)) return; report.level = l; try { localStorage.setItem('zca.reportLevel', l); } catch { /* bỏ qua */ } renderLevelSeg(); if (report.data && $('#dlgReport').open) renderReportBody(report.data); if (chat.key) renderSideClaude(); }
  $('#rpLevel').addEventListener('click', (e) => { const b = e.target.closest('button[data-level]'); if (b) setLevel(b.dataset.level); });
  const fmtDate = (d) => d.split('-').reverse().join('/');
  async function openReport() {
    $('#dlgReport').showModal(); $('#rpBody').innerHTML = '<div class="empty">Đang tải…</div>';
    try { const d = await api('/api/report/dates'); report.dates = d.dates; report.today = d.today; if (!report.date) report.date = d.dates.includes(d.today) ? d.today : (d.dates[0] || d.today); renderDateSelect(); await loadReport(); } catch (err) { $('#rpBody').innerHTML = '<div class="empty">' + esc(err.message) + '</div>'; }
  }
  function renderDateSelect() {
    const sel = $('#rpDate'); const all = [...new Set([report.today, ...report.dates])].filter(Boolean).sort().reverse();
    sel.innerHTML = all.map((d) => '<option value="' + d + '">' + (d === report.today ? 'Hôm nay · ' : '') + fmtDate(d) + '</option>').join('');
    sel.value = report.date;
    $('#rpPrev').disabled = all.indexOf(report.date) >= all.length - 1; $('#rpNext').disabled = all.indexOf(report.date) <= 0;
  }
  async function loadReport() {
    const r = await api('/api/report?date=' + encodeURIComponent(report.date)); report.data = r;
    const srcText = r.hasClaude ? 'Tổng hợp bởi Claude lúc ' + fmtTime(r.claudeAt) : 'Chưa có bản tổng hợp của Claude cho ngày này — đang hiện số liệu từ ứng dụng' + (r.conversations.some((c) => c.claude) ? ' + tóm tắt từ gợi ý gần nhất' : '');
    $('#rpSource').textContent = srcText; $('#rpSource').title = srcText;
    $('#rpOpenMd').hidden = !r.mdPath; $('#rpOpenMd').onclick = () => api('/api/open', { method: 'POST', body: { path: r.mdPath } }).catch((e) => toast(e.message));
    renderLevelSeg(); renderReportBody(r);
  }
  /** Vẽ thân báo cáo theo mức: full = mọi mục; medium = diễn biến + đã chốt + việc + câu hỏi; brief = 1–2 câu mỗi hội thoại. */
  function renderReportBody(r) {
    const lv = report.level; const o = r.overview;
    const tiles = '<div class="rp-tiles"><div class="tile"><div class="v">' + num(o.conversations) + '</div><div class="l">Hội thoại có tin</div></div><div class="tile"><div class="v">' + num(o.messages) + '</div><div class="l">Tin nhắn · ' + num(o.inbound) + ' đến / ' + num(o.outbound) + ' đi</div></div><div class="tile ' + (o.needReply ? 'hot' : '') + '"><div class="v">' + num(o.needReply) + '</div><div class="l">Chưa trả lời</div></div><div class="tile ' + (o.tasksForYou ? 'hot' : '') + '"><div class="v">' + num(o.tasksForYou) + '</div><div class="l">Việc cần làm</div></div></div>';
    const ovText = lv === 'brief' ? (o.claudeBrief || firstSentences(o.claudeSummary, 3)) : o.claudeSummary;
    const overview = (ovText || (o.highlights || []).length) ? '<div class="card"><h2>Tổng quan</h2>' + (ovText ? '<div class="rp-sum">' + paras(ovText) + '</div>' : '') + ((o.highlights || []).length ? '<ul class="rp-hl">' + o.highlights.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' : '') + '</div>' : '';
    const accOf = (a) => a.accountId || r.conversations.find((c) => c.threadId === String(a.threadId))?.accountId || '';
    const actions = (r.actionItems || []).length ? '<div class="card"><h2>✅ Việc cần làm (' + r.actionItems.length + ')</h2><ul class="rp-actions">' + r.actionItems.map((a) => '<li>' + (a.priority ? '<span class="pill ' + (a.priority === 'P1' ? 'bad' : a.priority === 'P2' ? 'warn' : '') + '">' + esc(a.priority) + '</span> ' : '') + (a.threadId ? '<a href="#" data-openconv="' + esc(accOf(a) + '|' + a.threadId) + '"><b>' + esc(a.name || '') + '</b></a>' : '<b>' + esc(a.name || '') + '</b>') + ' — ' + esc(a.task || '') + (a.due ? ' <span class="faint">(' + esc(a.due) + ')</span>' : '') + '</li>').join('') + '</ul></div>' : '';
    const convs = r.conversations.length ? '<div class="card"><h2>Từng hội thoại (' + r.conversations.length + ')</h2>' + r.conversations.map((c) => {
      const cl = c.claude; const [scls, slabel] = cl?.sentiment ? (SENT[cl.sentiment] || ['', cl.sentiment]) : ['', ''];
      const head = '<div class="rp-top"><b>' + (c.isGroup ? '👥 ' : '') + esc(c.name || c.threadId) + '</b>' + (cl?.relation ? '<span class="pill" title="' + esc(cl.relationNote || '') + '">' + esc(REL[cl.relation] || cl.relation) + '</span>' : '') + (slabel ? '<span class="pill ' + scls + '">' + slabel + '</span>' : '') + (c.unread ? '<span class="badge-unread">' + c.unread + '</span>' : '') + '<span class="grow"></span><span class="faint small">' + (c.messages ? num(c.messages) + ' tin (' + num(c.inbound) + ' đến/' + num(c.outbound) + ' đi) · ' + fmtClock(c.firstAt) + '–' + fmtClock(c.lastAt) : 'không có tin trong ngày') + '</span></div>';
      const noSum = '<div class="rp-sum faint">Chưa có tóm tắt của Claude — tin cuối: ' + esc(c.lastPreview || '') + (c.lastOutbound ? ' (Bạn)' : '') + '</div>';
      let body;
      if (lv === 'brief') {
        const nT = (cl?.tasksForYou || []).length, nQ = (cl?.openQuestions || []).length;
        body = (cl ? '<div class="rp-sum">' + esc(briefOf(cl)) + (nT || nQ ? ' <span class="faint small">· ' + [nT ? nT + ' việc của Bạn' : '', nQ ? nQ + ' câu chưa trả lời' : ''].filter(Boolean).join(' · ') + '</span>' : '') + '</div>' : noSum);
      } else {
        body = (cl?.summary ? '<div class="rp-sum">' + paras(cl.summary) + '</div>' : noSum) +
          (lv === 'full' && (cl?.timeline || []).length ? '<ul class="rp-tl">' + cl.timeline.map((t) => '<li>' + (t.time ? '<b>' + esc(t.time) + '</b> ' : '') + esc(t.what) + '</li>').join('') + '</ul>' : '') +
          (lv === 'full' && (cl?.keyFacts || []).length ? '<div class="rp-list facts"><b>Thông tin đáng nhớ:</b> ' + cl.keyFacts.map(esc).join(' · ') + '</div>' : '') +
          (lv === 'full' && (cl?.topics || []).length ? '<div class="rp-tags">' + cl.topics.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
          ((cl?.decisions || []).length ? '<div class="rp-list"><b>Đã chốt:</b> ' + cl.decisions.map(esc).join(' · ') + '</div>' : '') +
          ((cl?.tasksForYou || []).length ? '<div class="rp-list todo"><b>Việc của Bạn:</b> ' + cl.tasksForYou.map(esc).join(' · ') + '</div>' : '') +
          ((cl?.openQuestions || []).length ? '<div class="rp-list ask"><b>Chưa trả lời:</b> ' + cl.openQuestions.map(esc).join(' · ') + '</div>' : '');
      }
      return '<div class="rp-conv' + (lv === 'brief' ? ' brief' : '') + '" data-openconv="' + esc((c.accountId || '') + '|' + c.threadId) + '">' + avatarHtml(c.avatarUrl, c.name, 'sm') + '<div class="rp-body">' + head + body + '</div></div>';
    }).join('') + '</div>' : '<div class="card"><div class="empty">Không có hội thoại nào có tin trong ngày này.</div></div>';
    $('#rpBody').innerHTML = tiles + overview + actions + convs;
  }
  $('#btnReport').onclick = openReport;
  $('#rpDate').onchange = () => { report.date = $('#rpDate').value; renderDateSelect(); loadReport().catch((e) => toast(e.message)); };
  const stepDate = (dir) => { const o = [...$('#rpDate').options]; const i = o.findIndex((x) => x.value === report.date); const j = i + dir; if (j >= 0 && j < o.length) { report.date = o[j].value; renderDateSelect(); loadReport().catch((e) => toast(e.message)); } };
  $('#rpPrev').onclick = () => stepDate(1); $('#rpNext').onclick = () => stepDate(-1);
  $('#rpBody').addEventListener('click', (e) => { const el = e.target.closest('[data-openconv]'); if (!el) return; e.preventDefault(); const key = el.dataset.openconv; if (!key || key.startsWith('|')) return; $('#dlgReport').close(); openConversation(key); });
  $('#rpCopy').onclick = async () => {
    const r = report.data; if (!r) return;
    const lv = report.level; const o = r.overview;
    const lines = ['# Báo cáo ngày ' + fmtDate(r.date) + ' (' + { full: 'chi tiết', medium: 'vừa đủ', brief: 'cô đọng' }[lv] + ')', '', (lv === 'brief' ? (o.claudeBrief || firstSentences(o.claudeSummary, 3)) : o.claudeSummary) || '', ...(o.highlights || []).map((h) => '- ' + h), '', 'Hội thoại có tin: ' + o.conversations + ' · Tin: ' + o.messages + ' · Chưa trả lời: ' + o.needReply + ' · Việc cần làm: ' + o.tasksForYou, ''];
    if ((r.actionItems || []).length) { lines.push('## Việc cần làm'); for (const a of r.actionItems) lines.push('- ' + (a.priority ? '[' + a.priority + '] ' : '') + (a.name ? a.name + ': ' : '') + a.task + (a.due ? ' (' + a.due + ')' : '')); lines.push(''); }
    for (const c of r.conversations) {
      const cl = c.claude; lines.push('## ' + (c.isGroup ? '[Nhóm] ' : '') + (c.name || c.threadId) + (c.messages ? ' — ' + c.messages + ' tin' : ''));
      if (lv === 'brief') { if (cl) lines.push(briefOf(cl)); lines.push(''); continue; }
      if (cl?.summary) lines.push(cl.summary);
      if (lv === 'full' && cl?.timeline?.length) lines.push(...cl.timeline.map((t) => '- ' + (t.time ? t.time + ' ' : '') + t.what));
      if (lv === 'full' && cl?.keyFacts?.length) lines.push('Thông tin đáng nhớ: ' + cl.keyFacts.join('; '));
      if (cl?.decisions?.length) lines.push('Đã chốt: ' + cl.decisions.join('; '));
      if (cl?.tasksForYou?.length) lines.push('Việc của Bạn: ' + cl.tasksForYou.join('; '));
      if (cl?.openQuestions?.length) lines.push('Chưa trả lời: ' + cl.openQuestions.join('; '));
      lines.push('');
    }
    await copyText(lines.join('\n'), 'Đã sao chép báo cáo.');
  };

  // ── Hộp thoại: bấm nền tối, phím Esc hoặc nút ✕ (tự chèn) đều đóng; QR thì dừng hỏi trạng thái; mẫu tin đang sửa dở thì không đóng vì bấm nhầm ra ngoài.
  function closeDialog(d) {
    if (d.id === 'dlgQr') clearInterval(state.qrTimer);
    d.close();
  }
  function tplDirty() { const t = tplEditing !== null ? state.templates[tplEditing] : null; return ($('#tplTitle').value.trim() !== (t?.title || '')) || ($('#tplText').value.trim() !== (t?.text || '')); }
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target !== d) return; if (d.id === 'dlgTemplate' && tplDirty()) { toast('Mẫu đang sửa chưa lưu — bấm Lưu mẫu hoặc ✕ để bỏ.'); return; } closeDialog(d); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(d); });
    const wrap = d.firstElementChild;
    if (wrap && !wrap.querySelector('.dlg-x')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'dlg-x'; b.title = 'Đóng (Esc)'; b.setAttribute('aria-label', 'Đóng'); b.textContent = '✕'; b.onclick = () => closeDialog(d); wrap.prepend(b); }
  });

  // ── QR ───────────────────────────────────────────────────────────────────
  async function openQr() {
    $('#dlgQr').showModal(); $('#qrImageWrap').innerHTML = '<div class="placeholder">Đang tạo mã QR…</div>';
    const st = $('#qrState'); st.className = 'qr-state'; st.textContent = 'Đang tạo mã…';
    try { const r = await api('/api/accounts/login-qr', { method: 'POST' }); state.qrKey = r.key; showQr(r); clearInterval(state.qrTimer); state.qrTimer = setInterval(pollQr, 1500); }
    catch (err) { st.className = 'qr-state bad'; st.textContent = 'Không tạo được mã: ' + err.message; }
  }
  function showQr(r) {
    if (r.qrImage) $('#qrImageWrap').innerHTML = '<img src="' + r.qrImage + '" alt="Mã QR">';
    const st = $('#qrState');
    const map = { pending: ['', 'Đang chờ bạn quét mã…'], scanned: ['ok', 'Đã quét' + (r.scannedName ? ' — ' + r.scannedName : '') + '. Hãy bấm Đồng ý trên điện thoại.'], success: ['ok', '✅ Đăng nhập thành công!'], expired: ['bad', 'Mã đã hết hạn — bấm "Tạo mã mới".'], declined: ['bad', 'Bạn đã từ chối trên điện thoại.'], failed: ['bad', 'Đăng nhập thất bại' + (r.error ? ': ' + r.error : '')] };
    const [cls, text] = map[r.state] || ['', r.state]; st.className = 'qr-state ' + cls; st.textContent = text;
    if (r.state === 'success') { clearInterval(state.qrTimer); setTimeout(() => { $('#dlgQr').close(); refreshState(); vlist.reset(); }, 1200); }
    if (['expired', 'declined', 'failed'].includes(r.state)) clearInterval(state.qrTimer);
  }
  async function pollQr() { if (!state.qrKey) return; try { showQr(await api('/api/accounts/login-qr/' + state.qrKey)); } catch { /* bỏ qua */ } }
  $('#btnQrRetry').onclick = openQr; $('#btnQrClose').onclick = () => { clearInterval(state.qrTimer); $('#dlgQr').close(); };

  // ── Realtime ─────────────────────────────────────────────────────────────
  let reloadTimer, esRetry = 3000;
  const scheduleReload = (ev) => { clearTimeout(reloadTimer); reloadTimer = setTimeout(async () => { try { const wasLocked = state.locked; await refreshState(); if (state.locked) return; if (wasLocked) { vlist.reset(); void loadTemplates(); return; } await vlist.refresh(); if (chat.key && (ev === 'message' || ev === 'suggestions')) await refreshOpenChat(); } catch { /* bỏ qua */ } }, 500); };
  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onopen = () => { esRetry = 3000; };
    ['message', 'status', 'progress', 'auth', 'security', 'workspace', 'suggestions', 'power'].forEach((ev) => es.addEventListener(ev, () => scheduleReload(ev)));
    es.addEventListener('qr', (e) => { try { const d = JSON.parse(e.data); if (d.key === state.qrKey) showQr(d); } catch { /* bỏ qua */ } });
    es.onerror = () => { es.close(); setTimeout(connectEvents, esRetry); esRetry = Math.min(esRetry * 2, 30000); };
  }

  (async () => {
    vlist.init(); initSide();
    try { await refreshState(); } catch (err) { toast('Không kết nối được với ứng dụng: ' + err.message); }
    if (!state.locked) { vlist.reset(); void loadTemplates(); }
    connectEvents();
    setInterval(() => { refreshState().catch(() => {}); }, 30000);
  })();
})();
