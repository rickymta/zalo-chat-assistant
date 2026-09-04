/**
 * Tra hồ sơ người/nhóm/sticker qua zca-js, có cache theo tiến trình + xếp hàng tuần tự.
 *
 * Tin đến của zca-js chỉ có `dName`, KHÔNG có ảnh/SĐT; muốn có phải gọi `getUserInfo` — một lời gọi mạng
 * tới Zalo. Bắt buộc cache và gọi tuần tự có nghỉ giữa các lần: dồn dập là hành vi bất thường, dễ bị khoá.
 */
export class ProfileResolver {
  constructor(log, { gapMs = 350 } = {}) {
    this.log = log;
    this.gapMs = gapMs;
    this.users = new Map();     // uid → { name, avatar, phone }
    this.groups = new Map();    // gid → { name, avatar }
    this.stickers = new Map();  // id → url|null
    this.chain = Promise.resolve();
  }

  /** Xếp hàng tuần tự để không bao giờ bắn nhiều request hồ sơ cùng lúc. */
  enqueue(fn) {
    const run = this.chain.then(fn, fn).then(async (v) => {
      await new Promise((r) => setTimeout(r, this.gapMs));
      return v;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async user(api, uid) {
    if (!uid) return {};
    if (this.users.has(uid)) return this.users.get(uid);
    return this.enqueue(async () => {
      if (this.users.has(uid)) return this.users.get(uid);
      try {
        const res = await api?.getUserInfo?.(uid);
        const p = res?.changed_profiles?.[uid] ?? res?.changed_profiles?.[String(uid)] ?? null;
        const value = {
          name: p?.displayName ?? p?.zaloName ?? null,
          avatar: p?.avatar ?? null,
          phone: p?.phoneNumber ?? null,
        };
        this.users.set(uid, value);
        return value;
      } catch (err) {
        // Nhớ kết quả rỗng: đối phương chặn/ẩn thì lần sau cũng hỏng, đừng thử lại mỗi tin.
        this.users.set(uid, {});
        this.log.warn(`Không tra được hồ sơ ${uid}: ${err?.message ?? err}`);
        return {};
      }
    });
  }

  async group(api, gid) {
    if (!gid) return {};
    if (this.groups.has(gid)) return this.groups.get(gid);
    return this.enqueue(async () => {
      if (this.groups.has(gid)) return this.groups.get(gid);
      try {
        const res = await api?.getGroupInfo?.(gid);
        const g = res?.gridInfoMap?.[gid] ?? null;
        const value = { name: g?.name ?? null, avatar: g?.fullAvt ?? g?.avt ?? null };
        this.groups.set(gid, value);
        return value;
      } catch (err) {
        this.groups.set(gid, {});
        this.log.warn(`Không tra được thông tin nhóm ${gid}: ${err?.message ?? err}`);
        return {};
      }
    });
  }

  async sticker(api, id) {
    const key = Number(id);
    if (!Number.isFinite(key)) return null;
    if (this.stickers.has(key)) return this.stickers.get(key);
    return this.enqueue(async () => {
      if (this.stickers.has(key)) return this.stickers.get(key);
      try {
        const details = await api?.getStickersDetail?.(key);
        const first = Array.isArray(details) ? details[0] : details;
        const url = first?.stickerWebpUrl ?? first?.stickerUrl ?? null;
        this.stickers.set(key, url);
        return url;
      } catch (err) {
        this.stickers.set(key, null);
        this.log.warn(`Không tra được ảnh sticker ${key}: ${err?.message ?? err}`);
        return null;
      }
    });
  }

  /** Nạp sẵn cache từ danh bạ đã đồng bộ — tránh gọi mạng cho người đã biết. */
  primeUser(uid, value) {
    if (uid && value && !this.users.has(uid)) this.users.set(uid, value);
  }
}
