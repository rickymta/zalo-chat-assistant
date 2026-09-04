/**
 * Lịch sử tin nhắn NHÓM qua endpoint MỚI của Zalo Web.
 *
 * `api.getGroupChatHistory` của zca-js 2.1.2 gọi `/api/group/history` — Zalo đã bỏ đường này (trả 404 cho MỌI nhóm,
 * xác nhận 05/09/2026 với 65/65 nhóm; issue #356/#367 trên GitHub zca-js còn mở). Bản vá PR #370 (chưa merge) chuyển sang
 * `group_cloud_message/api/cm/getrecentv2`, phân trang 50 tin/lần bằng con trỏ `lastMsgId`. Ở đây cài lại đúng cách đó
 * bằng cơ chế `api.custom(...)` của zca-js để không phải fork thư viện; khi zca-js phát hành bản có sẵn thì gỡ file này.
 */
import { GroupMessage } from 'zca-js';

const PAGE_SIZE = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function installGroupHistoryV2(api) {
  if (typeof api?.getGroupHistoryV2 === 'function') return;
  api.custom('getGroupHistoryV2', async ({ ctx, utils, props }) => {
    const { groupId, count = 300, onPage } = props ?? {};
    const base = api.zpwServiceMap?.group_cloud_message?.[0];
    if (!base) throw new Error('Phiên không có service group_cloud_message.');
    const gid = String(groupId).replace(/^g/, '');

    const out = [];
    const seen = new Set();
    let cursor = 0;
    let hasMore = true;
    let guard = 0;
    let meta = null;   // siêu dữ liệu trang cuối (không gồm tin) — để chẩn đoán

    while (hasMore && out.length < count && guard++ < 100) {
      const params = {
        groupId: gid,
        globalMsgId: cursor,
        count: Math.min(PAGE_SIZE, count - out.length),
        msgIds: [],
        imei: ctx.imei,
        src: 3,
      };   // KHÔNG thêm trường lạ vào params (thêm `retry` ⇒ Zalo trả mã 604)
      const encrypted = utils.encodeAES(JSON.stringify(params));
      if (!encrypted) throw new Error('Không mã hoá được tham số.');
      // Giống Zalo Web: `nretry=0` đi trên query string (ngoài phần mã hoá), không nằm trong params.
      const url = utils.makeURL(`${base}/api/cm/getrecentv2`, { params: encrypted, nretry: 0 });
      const response = await utils.request(url, { method: 'GET' });
      const data = await utils.resolve(response, (result) => {
        const d = result?.data;
        return typeof d === 'string' ? JSON.parse(d) : d;
      });

      const raws = Array.isArray(data?.groupMsgs) ? data.groupMsgs : [];
      meta = Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => k !== 'groupMsgs'));
      for (const raw of raws) {
        const id = String(raw?.msgId ?? '');
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const msg = new GroupMessage(ctx.uid, raw);
        // Tin lịch sử: uidFrom là uid thật (không phải "0" như tin live) ⇒ tự tính isSelf; threadId ép về id nhóm
        // đã hỏi để mọi tin cùng nhóm về đúng một hội thoại dù Zalo trả idTo dạng khác.
        msg.isSelf = msg.isSelf || String(raw?.uidFrom ?? '') === String(ctx.uid);
        msg.threadId = String(groupId).replace(/^g/, '');
        out.push(msg);
      }

      const next = Number(data?.lastMsgId ?? 0);
      hasMore = !!data?.hasMore && Number.isFinite(next) && next > 0 && next !== cursor && raws.length > 0;
      cursor = next;
      onPage?.(out.length);
      if (hasMore) await sleep(400);
    }
    return { groupMsgs: out, hasMore, meta };
  });
}
