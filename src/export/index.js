/** Điều phối một lần xuất: tạo thư mục, chạy các định dạng đã chọn, ghi lịch sử. Dùng chung cho UI và CLI. */
import path from 'node:path';
import { exportExcel } from './excel.js';
import { exportMarkdown } from './markdown.js';
import { resolveSelection, accountsMap, ensureDir, stampVn } from './common.js';

/**
 * @param {{ db:any, params:any, exportsDir:string, coworkDir:string, log:any, settings:any }} deps
 * params: { formats: ['markdown'|'excel'], accountIds?, from?, to?, includeGroups?, onlyWaiting?, threadIds?, q?, includeJsonl? }
 */
export async function runExport({ db, params, exportsDir, coworkDir, log, settings }) {
  const formats = Array.isArray(params.formats) && params.formats.length ? params.formats : ['markdown'];
  const selection = resolveSelection(db, params);
  if (!selection.length) return { ok: false, error: 'Không có hội thoại nào khớp bộ lọc.' };

  const outDir = ensureDir(path.join(exportsDir, stampVn()));
  const accountsById = accountsMap(db);
  const waitingHours = Number(settings?.waitingHours ?? 2);
  // fullHistory: bộ lọc thời gian chỉ dùng để CHỌN hội thoại; tin nhắn trong file thì lấy toàn bộ.
  const msgFrom = params.fullHistory ? null : (params.from ?? null);
  const msgTo = params.fullHistory ? null : (params.to ?? null);
  const result = { ok: true, dir: outDir, conversations: selection.length, messages: 0, outputs: [] };

  log?.info(`Bắt đầu xuất ${selection.length} hội thoại → ${outDir} (${formats.join(', ')})`);

  if (formats.includes('markdown')) {
    const r = await exportMarkdown({
      db, selection, from: msgFrom, to: msgTo, outDir, accountsById, coworkDir,
      includeJsonl: !!params.includeJsonl, waitingHours,
    });
    result.messages = r.messages;
    result.waiting = r.waiting;
    result.outputs.push({ format: 'markdown', path: outDir, files: r.files });
  }
  if (formats.includes('excel')) {
    const r = await exportExcel({
      db, selection, from: msgFrom, to: msgTo, outDir, accountsById, waitingHours,
    });
    result.messages = result.messages || r.messages;
    result.outputs.push({ format: 'excel', path: r.filePath });
  }

  db.recordExport({ format: formats.join('+'), dir: outDir, conversations: result.conversations, messages: result.messages, params });
  log?.info(`Xuất xong: ${result.conversations} hội thoại, ${result.messages} tin.`);
  return result;
}
