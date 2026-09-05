import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Thư mục ui-src/ (file này nằm trong đó); đầu ra ghi vào ../src/ui/index.html
const S = path.dirname(fileURLToPath(import.meta.url)) + '/';
const v3 = fs.readFileSync(S + 'index.v3.html', 'utf8');
const head = v3.slice(0, v3.indexOf('</head>'));            // gồm 2 khối <style> cũ (login + v2)
const loginStart = v3.indexOf('<!-- ═══════════ ĐĂNG NHẬP ═══════════ -->');
const loginEnd = v3.indexOf('<!-- ═══════════ ỨNG DỤNG ═══════════ -->');
const loginBlock = v3.slice(loginStart, loginEnd);
const css = `
<style>
  /* ── v4: bố cục kiểu Zalo ── */
  .zapp { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
  .topbar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: var(--panel); border-bottom: 1px solid var(--line); flex: none; min-height: 58px; -webkit-app-region: drag; }
  .zapp.mac .topbar { padding-left: 86px; }
  .topbar button, .topbar select, .topbar input, .topbar .pill { -webkit-app-region: no-drag; }
  .brand-mini { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; white-space: nowrap; }
  .brand-mini .logo { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #0a66ff, #22b8ff); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 17px; }
  .zstrip { display: flex; align-items: center; gap: 8px; white-space: nowrap; min-width: 0; }
  .zstrip .pill { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
  .chipstat { background: #f1f5fb; border-radius: 999px; padding: 3px 10px; font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; }
  .chipstat b { color: var(--bad); }
  .ws-line .stats { display: flex; gap: 6px; flex-wrap: wrap; }
  .topbar select { height: 40px; }
  .topbar button { height: 40px; }
  button.icon { width: 42px; padding: 0; justify-content: center; font-size: 18px; }
  .ws-line { flex: none; padding: 5px 16px; font-size: 13px; color: var(--muted); background: #fbfcfe; border-bottom: 1px solid var(--line); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; min-height: 32px; }
  .zapp.mac .ws-line { padding-left: 16px; }
  #reencryptBar { flex: none; padding: 8px 16px 0; }
  /* Thanh báo có bản cập nhật — nền xanh nhạt cho bản thường, dùng .topbar-warn (nền cảnh báo) cho bản bắt buộc. */
  #updateBar { flex: none; padding: 8px 16px 0; }
  .topbar-info { background: var(--primary-soft); border: 1px solid #c7dcff; border-radius: 12px; padding: 10px 14px; font-size: 14px; }
  .upd-dlg { width: 720px; }
  .upd-notes { font-size: 14px; line-height: 1.6; margin-top: 10px; overflow-wrap: anywhere; }
  .upd-notes.plain { white-space: pre-wrap; }
  .upd-notes h1, .upd-notes h2, .upd-notes h3 { font-size: 15px; margin: 12px 0 6px; }
  .upd-notes ul, .upd-notes ol { margin: 6px 0; padding-left: 22px; }
  .upd-notes p { margin: 0 0 8px; }
  .upd-notes code { background: #f1f5fb; border-radius: 6px; padding: 1px 5px; }
  .hash { font-size: 12px; overflow-wrap: anywhere; }
  /* Lưới 3 cột + 2 thanh kéo; độ rộng cột 1 và 3 là biến CSS do JS đặt (kéo được, nhớ theo máy); cột giữa minmax(0,1fr) để không bao giờ đẩy cột 3 ra ngoài cửa sổ. */
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--c1, 300px) 6px minmax(0, 1fr) 6px var(--c3, 340px); }
  .cols.noside { grid-template-columns: var(--c1, 300px) 6px minmax(0, 1fr); }
  .cols.noside .sidecol, .cols.noside .gutter[data-gutter="2"] { display: none; }
  .convcol, .chatcol, .sidecol { min-width: 0; }
  .gutter { cursor: col-resize; position: relative; z-index: 2; background: var(--bg); }
  .gutter::after { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 2px; border-radius: 2px; background: transparent; transition: background .15s; }
  .gutter:hover::after, .gutter.active::after { background: var(--primary); }
  body.resizing { cursor: col-resize; user-select: none; }
  body.resizing .msgs, body.resizing .vlist { pointer-events: none; }
  .sidecol { border-left: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  .side-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); min-height: 58px; }
  .side-head b { font-size: 15px; }
  .side-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .sidecol .sug-card { border: 1px solid var(--line); border-left: 4px solid #f59e0b; border-radius: 12px; max-height: none; padding: 12px; }
  .sidecol .sug-card .head { position: static; }
  .sidecol .sug-card .head .acts { margin-left: 0; flex-basis: 100%; }
  .side-sec { border: 1px solid var(--line); border-radius: 12px; background: #fff; padding: 12px; }
  .side-sec .sec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; } .side-sec .sec-head b { font-size: 15px; }
  .sc-sum { font-size: 14px; line-height: 1.55; }
  .sidecol .rp-list ul { margin: 4px 0 0; padding-left: 18px; }
  .sidecol .rp-list { margin-top: 8px; }
  .sidecol .rp-tl { margin-top: 8px; }
  .sidecol .rp-tags { margin-top: 8px; }
  .sidecol .empty.small { padding: 10px 4px; font-size: 14px; }
  .tpl { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line); }
  .tpl:first-child { border-top: 0; }
  .tpl .t { flex: 1; min-width: 0; cursor: pointer; border-radius: 8px; padding: 4px 6px; margin: -4px -6px; }
  .tpl .t:hover { background: #eef4ff; }
  .tpl .t b { display: block; font-size: 14px; } .tpl .t span { display: block; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #btnSideToggle.active { background: #eef4ff; border-color: #c7dcff; }
  .tpl-dlg { width: 640px; }
  .sidecol .sug-card, .sidecol .side-sec { overflow-wrap: anywhere; min-width: 0; }
  .side-head b { white-space: nowrap; } .side-head #sideMeta { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .convcol { border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  .convcol .toolbar { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
  .convcol .toolbar input[type=search] { width: 100%; height: 40px; }
  .convcol .chips { display: flex; gap: 6px; }
  .convcol .foot { padding: 6px 12px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; }
  .vlist { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; }
  .vspacer { position: relative; width: 100%; }
  .conv { position: absolute; left: 0; right: 0; height: 72px; display: flex; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; border-radius: 0; }
  .conv:hover { background: #f4f7fc; }
  .conv.active { background: var(--primary-soft); }
  .conv .avatar { width: 48px; height: 48px; }
  .conv .body { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
  .conv .top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .conv .nm { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .conv.unread .nm, .conv.unread .pv { font-weight: 700; color: var(--text); }
  .conv .tm { font-size: 12px; color: var(--faint); white-space: nowrap; }
  .conv.unread .tm { color: var(--primary); font-weight: 600; }
  .conv .bottom { display: flex; align-items: center; gap: 6px; }
  .conv .pv { flex: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
  .badge-unread { flex: none; background: #ef4444; color: #fff; border-radius: 999px; font-size: 12px; font-weight: 700; min-width: 20px; height: 20px; padding: 0 6px; display: inline-grid; place-items: center; }
  .sugdot { flex: none; font-size: 13px; filter: saturate(1.2); }
  .sugdot.none { filter: grayscale(1); opacity: .5; }
  .conv.skeleton .avatar { background: #eef2f7; } .conv .sk { height: 12px; border-radius: 6px; background: #eef2f7; width: 70%; } .conv .sk.short { width: 40%; }
  .chatcol { display: flex; flex-direction: column; min-height: 0; background: #ebeef3; }
  .chatcol .chat-head { background: var(--panel); }
  .msgs { flex: 1; overflow-y: auto; padding: 12px 20px 16px; display: flex; flex-direction: column; }
  .msgs-top { text-align: center; color: var(--faint); font-size: 12px; padding: 4px 0 10px; flex: none; }
  #msgsList { display: flex; flex-direction: column; gap: 6px; }
  /* Tin nhắn kiểu Zalo: hàng ngang (avatar nhỏ ở nhóm) + cột bong bóng; hành động hiện khi rê chuột; cảm xúc bám góc bong bóng. */
  .msg { display: flex; flex-direction: row; align-items: flex-end; gap: 6px; content-visibility: auto; contain-intrinsic-size: auto 56px; padding: 1px 0; }
  .msg.out { justify-content: flex-end; }
  .msg .mcol { display: flex; flex-direction: column; align-items: flex-start; max-width: 74%; min-width: 0; }
  .msg.out .mcol { align-items: flex-end; }
  .msg .avatar.xs { width: 28px; height: 28px; font-size: 11px; margin-bottom: 18px; flex: none; }
  .msg-acts { display: none; gap: 2px; align-self: center; margin-bottom: 8px; }
  .msg:hover .msg-acts { display: inline-flex; }
  .msg.out .msg-acts { order: -1; }
  .msg-acts button { width: 26px; height: 26px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: #fff; font-size: 13px; line-height: 1; display: grid; place-items: center; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .msg-acts button:hover { background: #eef4ff; border-color: #c7dcff; }
  .react-pop, .emoji-pop { position: fixed; z-index: 60; display: flex; gap: 4px; padding: 6px; background: #fff; border: 1px solid var(--line); border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.14); }
  .react-pop button { width: 34px; height: 34px; border: 0; background: transparent; border-radius: 50%; font-size: 20px; padding: 0; transition: transform .1s; }
  .react-pop button:hover { transform: scale(1.25); background: #f1f5fb; }
  .react-pop button.none { font-size: 13px; color: var(--muted); }
  .emoji-pop { position: absolute; left: 10px; bottom: 100%; margin-bottom: 6px; flex-wrap: wrap; width: 340px; border-radius: 12px; max-height: 200px; overflow: auto; }
  .emoji-pop button { width: 32px; height: 32px; border: 0; background: transparent; border-radius: 8px; font-size: 20px; padding: 0; }
  .emoji-pop button:hover { background: #f1f5fb; }
  .composer { position: relative; flex-direction: column; align-items: stretch; gap: 6px; }
  .compose-row { display: flex; gap: 8px; align-items: flex-end; }
  .compose-row textarea { flex: 1; }
  .emoji-btn { width: 40px; height: 40px; font-size: 20px; flex: none; border-radius: 50%; }
  .quote-bar { display: flex; align-items: center; gap: 10px; background: #f1f5fb; border-radius: 10px; padding: 6px 8px 6px 0; }
  .quote-bar .qb-line { width: 3px; align-self: stretch; background: var(--primary); border-radius: 2px; margin-left: 8px; }
  .quote-bar .qb-text { flex: 1; min-width: 0; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .quote-bar .qb-text b { display: block; color: var(--primary); font-size: 12.5px; }
  .msg .bubble .quote { display: flex; flex-direction: column; border-left: 3px solid var(--primary); background: rgba(10,102,255,.06); border-radius: 6px; padding: 4px 8px; margin-bottom: 6px; white-space: normal; }
  .msg .bubble .quote b { font-size: 12px; color: var(--primary); }
  .msg .bubble .quote span { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .msg .bubble { max-width: 100%; position: relative; padding: 8px 12px 6px; border-radius: 14px; background: #fff; border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; font-size: 15.5px; line-height: 1.45; }
  .msg.out .bubble { background: #e5efff; border-color: #c7dcff; }
  .msg .bubble.media { background: transparent; border: 0; padding: 0; }
  .msg .bubble.media .time { position: static; margin-top: 2px; }
  .msg .bubble .meta { font-size: 12px; color: var(--primary); font-weight: 600; margin-bottom: 2px; white-space: normal; }
  .msg .bubble .time { font-size: 11px; color: var(--faint); text-align: right; margin-top: 3px; }
  .msg .bubble .quote { border-left: 3px solid #c7d2de; padding-left: 8px; color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .msg .bubble.recalled { opacity: .65; }
  .atts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .att-img { max-width: 320px; max-height: 320px; border-radius: 12px; display: block; cursor: zoom-in; background: #eef2f7; }
  .sticker { width: 130px; height: 130px; object-fit: contain; display: block; }
  .att-video { max-width: 360px; border-radius: 12px; background: #000; }
  .att-audio { width: 260px; }
  .att-chip { display: inline-flex; align-items: center; gap: 6px; background: #f1f5fb; border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; font-size: 14px; text-decoration: none; color: var(--text); }
  .att-chip.file { color: var(--primary); }
  .reacts { display: flex; gap: 4px; margin-top: -10px; padding: 0 8px; position: relative; z-index: 1; }
  .msg.out .reacts { justify-content: flex-end; }
  .react { background: #fff; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; padding: 1px 7px; box-shadow: 0 1px 3px rgba(0,0,0,.12); cursor: default; }
  .react.mine { border-color: var(--primary); background: var(--primary-soft); cursor: pointer; }
  .react.mine:hover { background: #fee2e2; border-color: #fca5a5; }
  .day-sep { align-self: center; font-size: 12px; color: var(--faint); background: #e9eef6; border-radius: 999px; padding: 3px 12px; margin: 6px 0; }
  .settings-dlg { width: 860px; max-width: min(94vw, 1100px); padding: 0; }
  .settings-wrap { display: flex; flex-direction: column; max-height: 88vh; position: relative; }
  .dlg { position: relative; }
  /* Nút ✕ cố định góc trên-phải của MỌI hộp thoại — luôn thấy dù đầu hộp thoại xuống dòng; ngoài ra bấm nền tối hoặc Esc cũng đóng. */
  .dlg-x { position: absolute; top: 8px; right: 8px; z-index: 5; width: 32px; height: 32px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: #fff; color: var(--muted); font-size: 15px; line-height: 1; display: grid; place-items: center; }
  .dlg-x:hover { background: #f1f5fb; color: var(--text); }
  .settings-head { padding-right: 48px; }
  .dlg h2 { padding-right: 40px; }
  .rp-sum p { margin: 0 0 8px; } .rp-sum p:last-child { margin-bottom: 0; }
  .settings-head { display: flex; align-items: center; gap: 12px; padding: 16px 22px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .settings-head h2 { font-size: 20px; }
  .settings-body { overflow: auto; padding: 18px 22px 24px; display: flex; flex-direction: column; gap: 16px; background: var(--bg); }
  .settings-body .card h2 { font-size: 17px; }
  .report-dlg { width: 980px; }
  .report-dlg .settings-head { flex-wrap: nowrap; }
  #rpSource { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .settings-tools { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 22px; border-bottom: 1px solid var(--line); background: #fbfcfe; flex-wrap: wrap; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; }
  .seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 0; font-size: 13px; font-weight: 500; background: transparent; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.active { background: var(--primary); color: #fff; }
  .rp-conv.brief { padding: 8px 6px; } .rp-conv.brief .rp-sum { margin-top: 2px; }
  .seg.sm button { height: 24px; padding: 0 8px; font-size: 12px; }
  .sidecol .sec-head .seg { margin-right: 4px; }
  .trial-box { margin-top: 16px; padding: 12px 14px; border: 1px dashed #c9d2de; border-radius: 12px; display: flex; gap: 12px; align-items: center; font-size: 13px; color: var(--muted); line-height: 1.45; }
  .trial-box b { display: block; color: var(--text); font-size: 14px; margin-bottom: 2px; }
  .trial-box button { flex: none; }
  /* Hộp xem ảnh */
  .img-dlg { background: transparent; box-shadow: none; max-width: 96vw; padding: 0; }
  .img-dlg::backdrop { background: rgba(8, 12, 22, .84); }
  .img-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 10px 8px; background: #0f1420; border-radius: 14px; }
  .img-stage { max-width: 92vw; max-height: 78vh; overflow: auto; display: grid; place-items: center; border-radius: 10px; min-width: 240px; min-height: 120px; }
  .img-stage img { max-width: 92vw; max-height: 78vh; display: block; border-radius: 10px; background: #000; cursor: zoom-in; }
  .img-wrap.zoomed .img-stage img { max-width: none; max-height: none; cursor: zoom-out; }
  .img-msg { color: #e5e7eb; padding: 40px 30px; text-align: center; font-size: 14px; max-width: 420px; line-height: 1.5; }
  .img-bar { display: flex; align-items: center; gap: 8px; width: 100%; color: #e5e7eb; }
  .img-bar .faint { color: #9ca3af; }
  .img-bar button { background: rgba(255,255,255,.1); color: #f3f4f6; border-color: rgba(255,255,255,.18); }
  .img-bar button:hover { background: rgba(255,255,255,.2); }
  .img-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255,255,255,.88); color: #111; font-size: 28px; line-height: 1; padding: 0; display: grid; place-items: center; z-index: 3; }
  .img-nav.prev { left: 14px; } .img-nav.next { right: 14px; }
  .img-nav:disabled { opacity: .25; }
  .img-dlg .dlg-x { top: 14px; right: 14px; }
  .att-open { display: inline-block; cursor: zoom-in; }
  [data-preview] .sticker { cursor: zoom-in; }
  /* Màn đăng nhập trong cửa sổ hẹp (~1000px): không cuộn ngang, ẩn cột giới thiệu, ô dùng thử xuống dòng. */
  .login-wrap { padding: 16px; box-sizing: border-box; overflow: auto; }
  .login-shell { max-width: calc(100vw - 32px); }
  @media (max-width: 1120px) { .login-shell { grid-template-columns: 1fr; width: 620px; min-height: 0; } .login-hero { display: none; } .login-card { padding: 28px 26px; } }
  @media (max-width: 1120px) { .trial-box { flex-wrap: wrap; } .trial-box button { width: 100%; } }
  .settings-foot { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 22px; border-top: 1px solid var(--line); background: var(--panel); }
  .ws-line #wsLine { flex: 1; min-width: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ws-line .grow { display: none; }
  .ws-line { flex-wrap: nowrap; }
  .zstrip .pill { min-width: 90px; }
  .zstrip { flex: 0 1 auto; overflow: hidden; }
  /* Thanh trên chật (< 1120px): giấu tên ứng dụng và nhãn "Mở thư mục" để pill Zalo và các nút chính còn chỗ. */
  @media (max-width: 1120px) { .brand-mini b { display: none; } .topbar button[data-open="workspace"] .lbl { display: none; } .topbar button[data-open="workspace"] { padding: 0 10px; } }
  .topbar select { max-width: 160px; }
  .report-dlg .settings-head h2 { white-space: nowrap; margin-right: 4px; }
  .report-dlg .settings-head select { max-width: 200px; }
  .rp-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .rp-tiles .tile .v { font-size: 30px; }
  .rp-sum { line-height: 1.55; margin: 6px 0 4px; }
  .rp-hl { margin: 8px 0 0; padding-left: 20px; line-height: 1.6; }
  .rp-actions { margin: 6px 0 0; padding-left: 20px; line-height: 1.7; }
  .rp-actions a { text-decoration: none; }
  .rp-conv { display: flex; gap: 12px; padding: 12px 6px; border-top: 1px solid var(--line); cursor: pointer; border-radius: 10px; }
  .rp-conv:hover { background: #f4f7fc; }
  .rp-conv:first-of-type { border-top: 0; }
  .rp-body { flex: 1; min-width: 0; }
  .rp-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .rp-top b { font-size: 16px; }
  .rp-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .rp-tags .tag { margin: 0; background: #eef2f7; color: var(--muted); }
  .rp-list { font-size: 14px; color: var(--muted); margin-top: 4px; }
  .rp-list.todo b { color: var(--warn); } .rp-list.ask b { color: var(--bad); }
  .rp-tl { margin: 6px 0 0; padding-left: 18px; font-size: 14px; color: var(--muted); line-height: 1.55; }
  .rp-tl b { color: #1f2937; font-weight: 600; }
  @media (max-width: 900px) { .cols { grid-template-columns: 300px 1fr; } .brand-mini b { display: none; } .rp-tiles { grid-template-columns: repeat(2, 1fr); } }

  /* ── Mật độ gọn (người dùng 05/09/2026: chữ và khoảng cách đang to) ── */
  .zapp, .settings-dlg { font-size: 14px; }
  .zapp button { height: 36px; padding: 0 12px; border-radius: 10px; font-size: 14px; }
  .zapp button.sm { height: 30px; padding: 0 10px; font-size: 13px; border-radius: 8px; }
  .zapp button.icon { width: 36px; font-size: 16px; }
  .zapp button.link { height: auto; padding: 0; }
  .zapp input[type=text], .zapp input[type=search], .zapp input[type=number], .zapp select { height: 36px; font-size: 14px; padding: 0 10px; }
  .topbar { min-height: 50px; padding: 6px 12px; gap: 8px; }
  .topbar select, .topbar button { height: 36px; }
  .brand-mini { font-size: 14px; } .brand-mini .logo { width: 28px; height: 28px; font-size: 15px; border-radius: 8px; }
  .zstrip .avatar.sm { width: 30px; height: 30px; font-size: 12px; }
  .chipstat { font-size: 12px; padding: 2px 9px; }
  .ws-line { font-size: 12.5px; min-height: 28px; padding: 4px 12px; }
  .convcol .toolbar { padding: 8px 10px; gap: 6px; }
  .convcol .toolbar input[type=search] { height: 34px; }
  .zapp .chip { height: 30px; padding: 0 12px; font-size: 13px; }
  .conv { height: 64px; padding: 8px 10px; gap: 10px; }
  .zapp .conv .avatar { width: 40px; height: 40px; font-size: 14px; }
  .conv .nm { font-size: 14px; } .conv .pv { font-size: 13px; } .conv .tm { font-size: 12px; }
  .convcol .foot { font-size: 11.5px; padding: 4px 10px; }
  .zapp .chat-head { padding: 8px 14px; min-height: 56px; gap: 10px; }
  .zapp .chat-head .who { min-width: 110px; }
  /* Khung chat hẹp (< 480px): ẩn nút "Cho Claude" để tên hội thoại và nút Trợ lý còn chỗ; nút Cập nhật ở thanh trên vẫn đưa dữ liệu cho Claude. */
  .chatcol { container-type: inline-size; }
  @container (max-width: 480px) { .chat-head #chatExportBtn { display: none; } }
  .zapp .chat-head .who b { font-size: 15px; } .zapp .chat-head .who .small { font-size: 12.5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zapp .chat-head button { flex: none; white-space: nowrap; }
  .zapp .chat-head .avatar { width: 40px; height: 40px; font-size: 14px; }
  .msgs { padding: 10px 14px 12px; }
  .zapp .chatcol .bubble { font-size: 14px; padding: 8px 12px 6px; border-radius: 12px; max-width: 100%; }
  .zapp .chatcol .bubble .meta { font-size: 11.5px; } .zapp .chatcol .bubble .time { font-size: 11px; } .zapp .chatcol .bubble .quote { font-size: 13px; }
  .day-sep { font-size: 12px; }
  .composer { padding: 8px 10px; }
  .composer textarea { font-size: 14px; min-height: 40px; padding: 8px 10px; }
  .side-head { min-height: 50px; padding: 8px 10px; }
  .side-head b { font-size: 14px; }
  .side-body { padding: 10px; gap: 10px; }
  .side-sec, .sidecol .sug-card { padding: 10px; border-radius: 10px; }
  .side-sec .sec-head b, .sidecol .sug-card .head .ttl { font-size: 14px; }
  .sidecol .sug-card .reply { font-size: 14px; padding: 10px 12px; line-height: 1.5; }
  .sidecol .sug-card .ctx, .sidecol .sug-card .reason, .sidecol .sug-card .warnnew { font-size: 13px; }
  .sidecol .sug-card .head .meta { font-size: 12px; }
  .sc-sum { font-size: 13.5px; line-height: 1.5; }
  .sidecol .rp-list, .sidecol .rp-tl { font-size: 13px; }
  .zapp .pill, .settings-dlg .pill { font-size: 12px; padding: 2px 8px; }
  .tpl .t b { font-size: 13.5px; } .tpl .t span { font-size: 12.5px; }
  .settings-dlg .card { padding: 14px 16px; } .settings-dlg .card h2 { font-size: 16px; }
  .settings-dlg .settings-head h2 { font-size: 18px; }
  .rp-tiles .tile { padding: 12px 16px; } .rp-tiles .tile .v { font-size: 26px; }
  .rp-sum, .rp-hl, .rp-actions { font-size: 14px; }
  .rp-top b { font-size: 15px; }
  .setting .txt b { font-size: 14px; } .setting .txt span { font-size: 12.5px; }
</style>`;
const body = fs.readFileSync(S + 'ui-v4-body.html', 'utf8');
const script = fs.readFileSync(S + 'ui-v4-script.js', 'utf8');
const out = head + css + '\n</head>\n<body>\n' + loginBlock + body + '\n<script>\n' + script + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(path.join(S, "..", "src", "ui", "index.html"), out);
const ids = [...out.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]);
const dynamic = new Set(['chatAvatar', 'btnCopyPrompt2', 'btnUseSug', 'btnCopySug']);
const missing = [...new Set(ids)].filter((id) => !out.includes(`id="${id}"`) && !dynamic.has(id));
console.log('UI v4:', out.split('\n').length, 'dòng;', missing.length ? 'THIẾU id: ' + missing.join(', ') : 'mọi id tĩnh có trong HTML');
new Function(script); console.log('script parse OK');
