// Thăm dò một lần: đăng nhập bằng phiên đã lưu (KHÔNG mở listener), gọi endpoint lịch sử nhóm mới cho 1 nhóm.
import fs from 'node:fs';
import { Zalo } from 'zca-js';
import { installGroupHistoryV2 } from '../src/zalo/groupHistory.js';
const s = JSON.parse(fs.readFileSync(process.env.SESSION_FILE, 'utf8'));
const api = await new Zalo({ selfListen: true, checkUpdate: false, logging: false }).login({ cookie: s.cookie, imei: s.imei, userAgent: s.userAgent });
installGroupHistoryV2(api);
const groups = await api.getAllGroups();
const ids = Object.keys(groups?.gridVerMap ?? {});
console.log('số nhóm:', ids.length);
let found = null;
for (const gid of ids.slice(0, 12)) {
  const t0 = Date.now();
  try {
    const r = await api.getGroupHistoryV2({ groupId: gid, count: 120 });
    console.log(`nhóm ${gid} → ${r.groupMsgs.length} tin, hasMore=${r.hasMore}, ${Date.now() - t0}ms, meta=${JSON.stringify(r.meta)}`);
    if (r.groupMsgs.length && !found) found = r;
  } catch (err) { console.log(`nhóm ${gid} → LỖI ${err?.message} (code ${err?.code})`); }
  await new Promise((r) => setTimeout(r, 700));
}
if (found) {
  for (const m of found.groupMsgs.slice(0, 3)) {
    const c = m.data?.content;
    console.log({ threadId: m.threadId, isSelf: m.isSelf, uidFrom: m.data?.uidFrom, idTo: m.data?.idTo, dName: m.data?.dName, ts: m.data?.ts, msgType: m.data?.msgType, msgId: m.data?.msgId, contentType: typeof c, contentLen: typeof c === 'string' ? c.length : Object.keys(c ?? {}).length });
  }
  const last = found.groupMsgs.at(-1);
  console.log('tin cũ nhất:', last ? new Date(Number(last.data?.ts)).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '-');
}
process.exit(0);
