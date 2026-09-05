/**
 * Thư mục làm việc với Claude Cowork — MỘT thư mục cố định, người dùng trỏ Cowork vào một lần là đủ.
 *
 *   <workspace>/CLAUDE.md          chỉ dẫn cho Claude (chép từ cowork/CLAUDE.md của ứng dụng — cập nhật mỗi lần khởi động)
 *   <workspace>/huong-dan/         bộ chỉ dẫn + tham chiếu MedDental (chép từ cowork/huong-dan/)
 *   <workspace>/du-lieu/           dữ liệu hội thoại đã GIẢI MÃ — ghi đè mỗi lần "Cập nhật dữ liệu cho Claude"
 *   <workspace>/ket-qua/           kết quả do Claude ghi
 *
 * Bản .app: workspace = ~/Documents/Zalo Chat Assistant. Chạy bằng Node: workspace = <root>/cowork (chính thư mục nguồn —
 * khi nguồn và đích trùng nhau thì bỏ qua bước chép).
 */
import fs from 'node:fs';
import path from 'node:path';
import { exportMarkdown } from './export/markdown.js';
import { exportExcel } from './export/excel.js';
import { resolveSelection, accountsMap, formatVn } from './export/common.js';

export function workspaceLayout(root) {
  return {
    root,
    docsDir: path.join(root, 'huong-dan'),
    dataDir: path.join(root, 'du-lieu'),
    resultsDir: path.join(root, 'ket-qua'),
    claudeMd: path.join(root, 'CLAUDE.md'),
    readme: path.join(root, 'README.md'),
  };
}

function copyTree(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name); const to = path.join(dest, e.name);
    if (e.isDirectory()) { n += copyTree(from, to); continue; }
    if (!/\.(md|txt|csv)$/i.test(e.name)) continue;
    fs.copyFileSync(from, to); n++;
    try { fs.chmodSync(to, 0o644); } catch { /* bỏ qua */ }   // chép từ asar có thể ra 0600 — để Cowork/Finder đọc thoải mái
  }
  return n;
}

/** Tạo/cập nhật thư mục làm việc từ thư mục cowork/ của ứng dụng. An toàn gọi mỗi lần khởi động. */
export function ensureWorkspace(root, sourceCoworkDir, log) {
  const L = workspaceLayout(root);
  for (const d of [L.root, L.docsDir, L.dataDir, L.resultsDir]) fs.mkdirSync(d, { recursive: true });
  const same = path.resolve(root) === path.resolve(sourceCoworkDir);
  if (!same) {
    const n = copyTree(path.join(sourceCoworkDir, 'huong-dan'), L.docsDir);
    for (const f of ['CLAUDE.md', 'README.md']) {
      const src = path.join(sourceCoworkDir, f);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(root, f)); try { fs.chmodSync(path.join(root, f), 0o644); } catch { /* bỏ qua */ } }
    }
    // Mục #5: chỉ MỘT gói. Thư mục gói kiểu cũ (yyyyMMdd-HHmmss) do bản trước tạo được dồn vào _goi-cu/ — không xoá dữ liệu
    // của người dùng, nhưng gốc thư mục làm việc luôn gọn để Cowork không lạc.
    try {
      const legacy = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name));
      if (legacy.length) {
        const archive = path.join(root, '_goi-cu');
        fs.mkdirSync(archive, { recursive: true });
        for (const e of legacy) fs.renameSync(path.join(root, e.name), path.join(archive, e.name));
        fs.writeFileSync(path.join(archive, 'README.md'), '# _goi-cu/\n\nCác gói dữ liệu do bản ứng dụng cũ tạo (mỗi lần xuất một thư mục). Bản mới chỉ dùng MỘT thư mục `du-lieu/` ghi đè. Thư mục này xoá được.\n');
        log?.info(`Đã dồn ${legacy.length} gói dữ liệu kiểu cũ vào ${archive}.`);
      }
    } catch (err) { log?.warn(`Không dọn được gói cũ: ${err?.message ?? err}`); }
    log?.info(`Thư mục làm việc Claude: ${root} (đã cập nhật ${n} file hướng dẫn).`);
  } else {
    // Nguồn = đích (chế độ dev): chỉ đảm bảo CLAUDE.md khớp bản 00.
    const src = path.join(L.docsDir, '00-chi-dan-cho-claude.md');
    if (fs.existsSync(src)) fs.copyFileSync(src, L.claudeMd);
  }
  if (!fs.existsSync(path.join(L.resultsDir, 'README.md'))) {
    fs.writeFileSync(path.join(L.resultsDir, 'README.md'), '# ket-qua/\n\nClaude ghi bản tổng hợp và đề xuất phản hồi vào đây (tên file `YYYY-MM-DD-tong-hop.md`). Tư vấn viên đọc, sửa rồi tự gửi trên Zalo.\n');
  }
  return L;
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
}

/**
 * Ghi đè du-lieu/ bằng dữ liệu mới. params như runExport: { accountIds, from, to, includeGroups, onlyWaiting,
 * onlyGroups, threadIds, fullHistory, includeExcel, includeJsonl }.
 */
export async function updateWorkspaceData({ db, params, root, log, settings, gaps = [] }) {
  const L = workspaceLayout(root);
  const selection = resolveSelection(db, params);
  if (!selection.length) return { ok: false, error: 'Không có hội thoại nào khớp lựa chọn.' };
  fs.mkdirSync(L.dataDir, { recursive: true });
  clearDir(L.dataDir);
  const accountsById = accountsMap(db);
  const waitingHours = Number(settings?.waitingHours ?? 2);
  const msgFrom = params.fullHistory ? null : (params.from ?? null);
  const msgTo = params.fullHistory ? null : (params.to ?? null);
  const md = await exportMarkdown({ db, selection, from: msgFrom, to: msgTo, outDir: L.dataDir, accountsById, coworkDir: null, includeJsonl: !!params.includeJsonl, waitingHours, workspaceMode: true });
  let excelPath = null;
  if (params.includeExcel) {
    const x = await exportExcel({ db, selection, from: msgFrom, to: msgTo, outDir: L.dataDir, accountsById, waitingHours });
    excelPath = x.filePath;
  }
  // Khoảng trống (máy ngủ / mất kết nối) trong 48 giờ: Claude phải biết tin trong khoảng đó có thể thiếu.
  const gapList = (Array.isArray(gaps) ? gaps : []).map((g) => ({ from: g.from, to: g.to, fromText: formatVn(g.from), toText: formatVn(g.to), minutes: Math.max(1, Math.round((g.to - g.from) / 60e3)) }));
  const result = { ok: true, dir: L.dataDir, root, conversations: md.conversations, messages: md.messages, waiting: md.waiting, excelPath, updatedAt: Date.now(), preset: params.preset ?? null, gaps: gapList };
  fs.writeFileSync(path.join(L.dataDir, '.trang-thai.json'), JSON.stringify(result, null, 2));
  if (gapList.length) {
    const note = ['', '## ⚠️ Khoảng trống có thể thiếu tin', '', 'Máy tính đã ngủ hoặc mất kết nối trong các khoảng sau (giờ Việt Nam). Tin đến trong lúc đó chỉ có trong gói nếu Zalo gửi bù khi nối lại. Khi tổng hợp: KHÔNG kết luận "không ai trả lời" cho khoảng này, ghi rõ khả năng thiếu tin và đề nghị người dùng kiểm tra trên điện thoại nếu quan trọng.', '', ...gapList.map((g) => `- ${g.fromText} → ${g.toText} (${g.minutes} phút)`), ''];
    try { fs.appendFileSync(path.join(L.dataDir, 'README-DU-LIEU.md'), note.join('\n')); } catch { /* bỏ qua */ }
  }
  db.recordExport({ format: params.includeExcel ? 'markdown+excel' : 'markdown', dir: L.dataDir, conversations: md.conversations, messages: md.messages, params });
  log?.info(`Cập nhật du-lieu/ cho Claude: ${md.conversations} hội thoại, ${md.messages} tin.`);
  return result;
}

export function clearWorkspaceData(root) {
  clearDir(workspaceLayout(root).dataDir);
  return { ok: true };
}

export function workspaceInfo(root) {
  const L = workspaceLayout(root);
  let status = null;
  try { status = JSON.parse(fs.readFileSync(path.join(L.dataDir, '.trang-thai.json'), 'utf8')); } catch { status = null; }
  const hasData = fs.existsSync(path.join(L.dataDir, '00-INDEX.md'));
  return { root, dataDir: L.dataDir, resultsDir: L.resultsDir, hasData, status, statusText: status ? `${status.conversations} hội thoại, ${status.messages} tin — ${formatVn(status.updatedAt)}` : null };
}
