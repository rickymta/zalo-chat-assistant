// Thăm dò biến thể tham số của /api/cm/getrecentv2 trên MỘT nhóm (chỉ đọc).
import fs from 'node:fs';
import { Zalo } from 'zca-js';
const s = JSON.parse(fs.readFileSync(process.env.SESSION_FILE, 'utf8'));
const api = await new Zalo({ selfListen: true, checkUpdate: false, logging: false }).login({ cookie: s.cookie, imei: s.imei, userAgent: s.userAgent });
api.custom('cmRaw', async ({ ctx, utils, props }) => {
  const base = api.zpwServiceMap.group_cloud_message[0];
  const params = typeof props.params === 'function' ? props.params(ctx) : props.params;
  const enc = utils.encodeAES(JSON.stringify(params));
  const url = utils.makeURL(`${base}${props.path ?? '/api/cm/getrecentv2'}`, { params: enc, ...(props.query ?? {}) });
  const res = await utils.request(url, props.post ? { method: 'POST', body: new URLSearchParams({ params: enc }) } : { method: 'GET' });
  return utils.resolve(res, (r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
});
const gid = process.env.ZGID;
const MAX = Number(process.env.MAXID), MIN = Number(process.env.MINID);
const rnd = () => "a1b2c3d4-" + Math.random().toString(16).slice(2, 10) + "-" + Date.now();
const variants = {
  A_base:          (ctx) => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [], imei: ctx.imei, src: 3 }),
  I_other_imei:    () => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [], imei: rnd(), src: 3 }),
  J_src0:          (ctx) => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [], imei: ctx.imei, src: 0 }),
  K_src2:          (ctx) => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [], imei: ctx.imei, src: 2 }),
  L_count20_str:   (ctx) => ({ groupId: gid, globalMsgId: "0", count: 20, msgIds: [], imei: ctx.imei, src: 3 }),
  M_cursor_max_str:(ctx) => ({ groupId: gid, globalMsgId: String(MAX), count: 50, msgIds: [], imei: ctx.imei, src: 3 }),
  N_msgIds_max:    (ctx) => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [String(MAX)], imei: ctx.imei, src: 3 }),
  O_post:          (ctx) => ({ groupId: gid, globalMsgId: 0, count: 50, msgIds: [], imei: ctx.imei, src: 3 }),
};
for (const [name, params] of Object.entries(variants)) {
  try {
    const d = await api.cmRaw({ params, query: { nretry: 0 }, post: name === 'O_post' });
    const n = Array.isArray(d?.groupMsgs) ? d.groupMsgs.length : (d?.groupMsgs === undefined ? 'no-key' : typeof d.groupMsgs);
    const keys = Object.keys(d ?? {}).join(',');
    console.log(name, '→ tin:', n, '| hasMore:', d?.hasMore, 'isFiltered:', d?.isFiltered, 'lastMsgId:', d?.lastMsgId, '| keys:', keys);
    if (Array.isArray(d?.groupMsgs) && d.groupMsgs.length) { const m = d.groupMsgs[0]; console.log('   mẫu:', Object.keys(m).join(','), '| msgType', m.msgType, '| ts', m.ts, '| uidFrom', m.uidFrom, '| idTo', m.idTo); }
  } catch (err) { console.log(name, '→ LỖI', err?.message, 'code', err?.code); }
  await new Promise((r) => setTimeout(r, 700));
}
process.exit(0);
