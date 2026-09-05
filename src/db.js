/**
 * Kho lưu chính: SQLite (better-sqlite3, chế độ WAL).
 *
 * Vì sao SQLite chứ không phải Excel làm kho gốc: người dùng mục tiêu có HÀNG NGHÌN hội thoại và tin nhắn
 * đến liên tục. Excel không chịu được ghi nối liên tục + chống trùng; SQLite thì một file, không cần cài
 * server, chịu được hàng triệu dòng, và mọi công cụ (kể cả Claude Cowork) đều đọc được. Excel/Markdown
 * chỉ là ĐẦU RA xuất theo yêu cầu (xem src/export/).
 */
import Database from 'better-sqlite3';
import { versionOf } from './crypto/cipher.js';

/** Cột NỘI DUNG được mã hoá theo trường. Khoá/thời gian/cờ (thread_id, event_time, is_group, counts…) giữ nguyên để lọc/sắp. */
const ENC = {
  messages: ['sender_name', 'text', 'attachments_json', 'quote_text', 'raw_json'],
  conversations: ['name', 'avatar_url', 'phone', 'last_message_preview', 'last_message_sender', 'note'],
  contacts: ['display_name', 'zalo_name', 'avatar_url', 'phone'],
  reactions: ['icon'],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                 -- uid Zalo của chủ tài khoản
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_error TEXT,
  last_user_msg_id TEXT,               -- msgId lớn nhất đã thấy ở hội thoại 1-1 (để xin tin bỏ lỡ)
  last_group_msg_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,             -- uid người đối thoại (1-1) hoặc id nhóm
  is_group INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  avatar_url TEXT,
  phone TEXT,
  first_message_at INTEGER,
  last_message_at INTEGER,
  last_message_preview TEXT,
  last_message_outbound INTEGER,       -- 1 = tin cuối do mình gửi; 0 = tin cuối của khách ⇒ đang chờ trả lời
  message_count INTEGER NOT NULL DEFAULT 0,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  PRIMARY KEY (account_id, thread_id)
);
CREATE INDEX IF NOT EXISTS ix_conversations_last ON conversations(account_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  zalo_msg_id TEXT,
  cli_msg_id TEXT,
  is_outbound INTEGER NOT NULL DEFAULT 0,
  sender_id TEXT,
  sender_name TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  attachments_json TEXT,
  quote_text TEXT,
  event_time INTEGER NOT NULL,         -- epoch ms theo Zalo
  source TEXT NOT NULL DEFAULT 'live', -- live | old_sync | demo
  recalled INTEGER NOT NULL DEFAULT 0, -- 1 = người gửi đã thu hồi
  raw_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_dedup ON messages(account_id, thread_id, zalo_msg_id);
CREATE INDEX IF NOT EXISTS ix_messages_thread_time ON messages(account_id, thread_id, event_time);
CREATE INDEX IF NOT EXISTS ix_messages_time ON messages(event_time);

CREATE TABLE IF NOT EXISTS contacts (
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  zalo_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,              -- zalo_msg_id của tin được thả cảm xúc
  reactor_id TEXT NOT NULL,          -- uid người thả
  icon TEXT,                         -- mã cảm xúc Zalo (mã hoá)
  ts INTEGER NOT NULL,
  PRIMARY KEY (account_id, thread_id, msg_id, reactor_id)
);
CREATE INDEX IF NOT EXISTS ix_reactions_thread ON reactions(account_id, thread_id);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  format TEXT NOT NULL,
  dir TEXT NOT NULL,
  conversations INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  params_json TEXT
);
`;

/** So sánh hai msgId dạng chuỗi số (có thể vượt 2^53) — trả true nếu a > b. */
function idGreater(a, b) {
  if (!a) return false;
  if (!b) return true;
  try { return BigInt(a) > BigInt(b); } catch { return String(a) > String(b); }
}

export function openDb(dbPath) {
  const db = new Database(dbPath);
  /** Bộ mã hoá hiện tại — null = chưa mở khoá (mọi thao tác ghi nội dung sẽ ném lỗi). */
  let cipher = null;
  const enc = (v) => { if (v === null || v === undefined) return null; if (!cipher?.ready) throw new Error('Chưa mở khoá mã hoá — không thể ghi dữ liệu.'); return cipher.encrypt(String(v)); };
  const dec = (v) => (cipher ? cipher.decrypt(v) : v);
  const decRow = (row, cols) => { if (!row) return row; const out = { ...row }; for (const c of cols) if (c in out) out[c] = dec(out[c]); return out; };
  const decMessage = (r) => decRow(r, ENC.messages);
  const decConversation = (r) => decRow(r, ENC.conversations);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  // Cột thêm sau bản đầu — thêm có điều kiện để CSDL cũ nâng cấp êm.
  const ensureColumn = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  ensureColumn('conversations', 'last_message_sender', 'TEXT');   // tên người gửi tin cuối (hữu ích với NHÓM)
  ensureColumn('accounts', 'groups_imported_at', 'INTEGER');        // đã nhập lịch sử nhóm lần đầu chưa (chỉ ghi khi đọc được tin)
  ensureColumn('accounts', 'groups_import_attempt_at', 'INTEGER'); // lần THỬ gần nhất — tự động chỉ thử lại sau 24 giờ
  ensureColumn('conversations', 'unread_count', 'INTEGER NOT NULL DEFAULT 0'); // chưa đọc như Zalo: tăng khi tin đến, về 0 khi mở/khi mình gửi
  ensureColumn('conversations', 'last_read_at', 'INTEGER');

  const st = {
    upsertAccount: db.prepare(`
      INSERT INTO accounts (id, display_name, avatar_url, phone, status, last_error, created_at, updated_at)
      VALUES (@id, @display_name, @avatar_url, @phone, @status, NULL, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, accounts.display_name),
        avatar_url   = COALESCE(excluded.avatar_url, accounts.avatar_url),
        phone        = COALESCE(excluded.phone, accounts.phone),
        status       = excluded.status,
        last_error   = NULL,
        updated_at   = excluded.updated_at`),
    setStatus: db.prepare(`UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`),
    getAccount: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
    listAccounts: db.prepare(`SELECT * FROM accounts ORDER BY created_at`),
    deleteAccount: db.prepare(`DELETE FROM accounts WHERE id = ?`),
    setLastMsgId: {
      user: db.prepare(`UPDATE accounts SET last_user_msg_id = ? WHERE id = ?`),
      group: db.prepare(`UPDATE accounts SET last_group_msg_id = ? WHERE id = ?`),
    },

    insertMessage: db.prepare(`
      INSERT OR IGNORE INTO messages
        (account_id, thread_id, zalo_msg_id, cli_msg_id, is_outbound, sender_id, sender_name, type, text,
         attachments_json, quote_text, event_time, source, raw_json, created_at)
      VALUES
        (@account_id, @thread_id, @zalo_msg_id, @cli_msg_id, @is_outbound, @sender_id, @sender_name, @type, @text,
         @attachments_json, @quote_text, @event_time, @source, @raw_json, @created_at)`),
    upsertConversation: db.prepare(`
      INSERT INTO conversations
        (account_id, thread_id, is_group, name, avatar_url, phone, first_message_at, last_message_at,
         last_message_preview, last_message_outbound, last_message_sender, message_count, inbound_count, outbound_count)
      VALUES
        (@account_id, @thread_id, @is_group, @name, @avatar_url, @phone, @event_time, @event_time,
         @preview, @is_outbound, @sender, 1, @inbound, @outbound)
      ON CONFLICT(account_id, thread_id) DO UPDATE SET
        name       = COALESCE(excluded.name, conversations.name),
        avatar_url = COALESCE(excluded.avatar_url, conversations.avatar_url),
        phone      = COALESCE(excluded.phone, conversations.phone),
        first_message_at = MIN(conversations.first_message_at, excluded.first_message_at),
        last_message_at  = MAX(conversations.last_message_at, excluded.last_message_at),
        last_message_preview = CASE WHEN excluded.last_message_at >= conversations.last_message_at
                                    THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
        last_message_outbound = CASE WHEN excluded.last_message_at >= conversations.last_message_at
                                     THEN excluded.last_message_outbound ELSE conversations.last_message_outbound END,
        last_message_sender = CASE WHEN excluded.last_message_at >= conversations.last_message_at
                                   THEN excluded.last_message_sender ELSE conversations.last_message_sender END,
        message_count  = conversations.message_count + 1,
        inbound_count  = conversations.inbound_count + excluded.inbound_count,
        outbound_count = conversations.outbound_count + excluded.outbound_count,
        unread_count   = CASE WHEN excluded.is_group >= 0 AND excluded.inbound_count = 1 AND @count_unread = 1 THEN conversations.unread_count + 1
                              WHEN excluded.outbound_count = 1 THEN 0 ELSE conversations.unread_count END`),
    markRead: db.prepare(`UPDATE conversations SET unread_count = 0, last_read_at = ? WHERE account_id = ? AND thread_id = ?`),
    updateConversationMeta: db.prepare(`
      UPDATE conversations SET
        name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url), phone = COALESCE(?, phone)
      WHERE account_id = ? AND thread_id = ?`),
    getConversation: db.prepare(`SELECT * FROM conversations WHERE account_id = ? AND thread_id = ?`),
    markRecalled: db.prepare(`
      UPDATE messages SET recalled = 1
      WHERE account_id = ? AND (zalo_msg_id = ? OR (cli_msg_id = ? AND cli_msg_id IS NOT NULL))`),

    upsertContact: db.prepare(`
      INSERT INTO contacts (account_id, user_id, display_name, zalo_name, avatar_url, phone, updated_at)
      VALUES (@account_id, @user_id, @display_name, @zalo_name, @avatar_url, @phone, @now)
      ON CONFLICT(account_id, user_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, contacts.display_name),
        zalo_name    = COALESCE(excluded.zalo_name, contacts.zalo_name),
        avatar_url   = COALESCE(excluded.avatar_url, contacts.avatar_url),
        phone        = COALESCE(excluded.phone, contacts.phone),
        updated_at   = excluded.updated_at`),
    fillConversationsFromContacts: db.prepare(`
      UPDATE conversations SET
        name = COALESCE(conversations.name, c.display_name, c.zalo_name),
        phone = COALESCE(conversations.phone, c.phone),
        avatar_url = COALESCE(conversations.avatar_url, c.avatar_url)
      FROM contacts c
      WHERE c.account_id = conversations.account_id AND c.user_id = conversations.thread_id
        AND conversations.account_id = ?`),
    getContact: db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND user_id = ?`),

    upsertReaction: db.prepare(`
      INSERT INTO reactions (account_id, thread_id, msg_id, reactor_id, icon, ts) VALUES (@account_id, @thread_id, @msg_id, @reactor_id, @icon, @ts)
      ON CONFLICT(account_id, thread_id, msg_id, reactor_id) DO UPDATE SET icon = excluded.icon, ts = excluded.ts`),
    deleteReaction: db.prepare(`DELETE FROM reactions WHERE account_id = ? AND thread_id = ? AND msg_id = ? AND reactor_id = ?`),
    insertExport: db.prepare(`
      INSERT INTO exports (created_at, format, dir, conversations, messages, params_json)
      VALUES (?, ?, ?, ?, ?, ?)`),
    listExports: db.prepare(`SELECT * FROM exports ORDER BY created_at DESC LIMIT 50`),
  };

  /**
   * Ghi một tin + cập nhật thống kê hội thoại trong CÙNG transaction.
   * Trả true nếu tin mới, false nếu đã có (trùng zalo_msg_id) — bên gọi dựa vào đó để không đếm đúp.
   */
  const insertMessageTx = db.transaction((row) => {
    const res = st.insertMessage.run({
      ...row,
      sender_name: enc(row.sender_name), text: enc(row.text), attachments_json: enc(row.attachments_json),
      quote_text: enc(row.quote_text), raw_json: enc(row.raw_json),
    });
    if (res.changes === 0) return false;
    st.upsertConversation.run({
      account_id: row.account_id,
      thread_id: row.thread_id,
      is_group: row.is_group ? 1 : 0,
      name: enc(row.conv_name ?? null),
      avatar_url: enc(row.conv_avatar ?? null),
      phone: enc(row.conv_phone ?? null),
      event_time: row.event_time,
      preview: enc(row.preview ?? null),
      is_outbound: row.is_outbound ? 1 : 0,
      sender: enc(row.sender_name ?? null),
      inbound: row.is_outbound ? 0 : 1,
      outbound: row.is_outbound ? 1 : 0,
      // Tin lịch sử/đồng bộ cũ không tính chưa đọc — chỉ tin live/gửi bù mới làm nổi hội thoại
      count_unread: (row.source === 'live' || row.source === 'old_sync') ? 1 : 0,
    });
    return true;
  });

  /** Dựng WHERE cho danh sách hội thoại — dùng chung cho giao diện và xuất. */
  function conversationFilter(p = {}) {
    const where = ['1=1'];
    const params = {};
    if (p.accountIds?.length) {
      where.push(`c.account_id IN (${p.accountIds.map((_, i) => `@acc${i}`).join(',')})`);
      p.accountIds.forEach((id, i) => { params[`acc${i}`] = id; });
    }
    if (p.onlyGroups) where.push('c.is_group = 1');
    else if (!p.includeGroups) where.push('c.is_group = 0');
    // "Đang chờ trả lời" chỉ có nghĩa với hội thoại 1-1 — trong nhóm không phải tin nào cũng cần mình trả lời.
    if (p.onlyWaiting) where.push('c.last_message_outbound = 0 AND c.is_group = 0');
    if (p.onlyUnread) where.push('c.unread_count > 0');
    // p.q KHÔNG lọc trong SQL: name/phone/preview đã mã hoá. Lọc bằng JS sau khi giải mã (xem applyQ).
    if (p.threadIds?.length) {
      where.push(`c.thread_id IN (${p.threadIds.map((_, i) => `@th${i}`).join(',')})`);
      p.threadIds.forEach((id, i) => { params[`th${i}`] = id; });
    }
    // Khoảng thời gian: hội thoại CÓ tin trong khoảng (không phải chỉ tin cuối nằm trong khoảng).
    if (p.from != null || p.to != null) {
      const cond = ['m.account_id = c.account_id', 'm.thread_id = c.thread_id'];
      if (p.from != null) { cond.push('m.event_time >= @from'); params.from = p.from; }
      if (p.to != null) { cond.push('m.event_time < @to'); params.to = p.to; }
      where.push(`EXISTS (SELECT 1 FROM messages m WHERE ${cond.join(' AND ')})`);
    }
    return { where: where.join(' AND '), params };
  }

  const applyQ = (rows, q) => {
    if (!q) return rows;
    const needle = String(q).toLowerCase();
    return rows.filter((c) => [c.name, c.phone, c.thread_id, c.last_message_preview, c.last_message_sender].some((v) => v && String(v).toLowerCase().includes(needle)));
  };

  return {
    raw: db,
    setCipher(c) { cipher = c; },
    get cipher() { return cipher; },
    get unlocked() { return !!cipher?.ready; },

    // ── Tài khoản ──────────────────────────────────────────────────────────────
    upsertAccount(a) {
      st.upsertAccount.run({
        id: a.id,
        display_name: a.displayName ?? null,
        avatar_url: a.avatarUrl ?? null,
        phone: a.phone ?? null,
        status: a.status ?? 'connected',
        now: Date.now(),
      });
    },
    setAccountStatus(id, status, error = null) { st.setStatus.run(status, error, Date.now(), id); },
    getAccount(id) { return st.getAccount.get(id); },
    listAccounts() { return st.listAccounts.all(); },
    deleteAccount(id) { st.deleteAccount.run(id); },
    setGroupsImportAttemptAt(id, ts = Date.now()) { db.prepare('UPDATE accounts SET groups_import_attempt_at = ? WHERE id = ?').run(ts, id); },
    setGroupsImportedAt(id, ts = Date.now()) { db.prepare('UPDATE accounts SET groups_imported_at = ? WHERE id = ?').run(ts, id); },
    /** Chỉ ghi khi msgId mới LỚN HƠN msgId đã lưu (tin cũ đồng bộ về không được kéo lùi con trỏ). */
    bumpLastMsgId(id, isGroup, msgId) {
      const acc = st.getAccount.get(id);
      const current = isGroup ? acc?.last_group_msg_id : acc?.last_user_msg_id;
      if (idGreater(msgId, current)) (isGroup ? st.setLastMsgId.group : st.setLastMsgId.user).run(String(msgId), id);
    },

    // ── Tin nhắn / hội thoại ───────────────────────────────────────────────────
    insertMessage(row) { return insertMessageTx(row); },
    markRecalled(accountId, globalMsgId, cliMsgId) {
      return st.markRecalled.run(accountId, globalMsgId || null, cliMsgId || null).changes;
    },
    updateConversationMeta(accountId, threadId, { name, avatarUrl, phone }) {
      st.updateConversationMeta.run(enc(name ?? null), enc(avatarUrl ?? null), enc(phone ?? null), accountId, threadId);
    },
    getConversation(accountId, threadId) { return decConversation(st.getConversation.get(accountId, threadId)); },
    markRead(accountId, threadId) { return st.markRead.run(Date.now(), accountId, threadId).changes > 0; },

    listConversations(p = {}) {
      const { where, params } = conversationFilter(p);
      const limit = Math.min(Number(p.limit ?? 200), 5000);
      const offset = Number(p.offset ?? 0);
      const base = `SELECT c.*, a.display_name AS account_name FROM conversations c LEFT JOIN accounts a ON a.id = c.account_id WHERE ${where} ORDER BY c.last_message_at DESC`;
      if (p.q) {
        // Tìm kiếm trên cột mã hoá: giải mã toàn bộ rồi lọc — vài nghìn hội thoại vẫn dưới trăm ms.
        const all = applyQ(db.prepare(base).all(params).map(decConversation), p.q);
        return { rows: all.slice(offset, offset + limit), total: all.length };
      }
      const rows = db.prepare(`${base} LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset }).map(decConversation);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE ${where}`).get(params).n;
      return { rows, total };
    },

    /** Toàn bộ hội thoại khớp bộ lọc (không phân trang) — dùng cho xuất. */
    selectConversationsForExport(p = {}) {
      const { where, params } = conversationFilter(p);
      return applyQ(db.prepare(`
        SELECT c.*, a.display_name AS account_name
        FROM conversations c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE ${where}
        ORDER BY c.last_message_at DESC`).all(params).map(decConversation), p.q);
    },

    /** Thống kê tin trong khoảng cho một hội thoại — phục vụ sheet Tổng quan. */
    conversationRangeStats(accountId, threadId, from, to) {
      return db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN is_outbound = 0 THEN 1 ELSE 0 END) AS inbound,
               SUM(CASE WHEN is_outbound = 1 THEN 1 ELSE 0 END) AS outbound,
               MIN(event_time) AS first_at, MAX(event_time) AS last_at
        FROM messages
        WHERE account_id = ? AND thread_id = ?
          AND (? IS NULL OR event_time >= ?) AND (? IS NULL OR event_time < ?)`)
        .get(accountId, threadId, from ?? null, from ?? null, to ?? null, to ?? null);
    },

    /** N tin gần nhất của một hội thoại, trả về theo thứ tự thời gian tăng dần (cho màn xem). */
    /** Một tin theo mã Zalo (để trả lời trích dẫn / thả cảm xúc). */
    getMessageByMsgId(accountId, threadId, zaloMsgId) {
      const row = db.prepare(`SELECT * FROM messages WHERE account_id = ? AND thread_id = ? AND zalo_msg_id = ?`).get(accountId, threadId, String(zaloMsgId));
      return row ? decMessage(row) : null;
    },
    getRecentMessages(accountId, threadId, { limit = 300, before = null } = {}) {
      const rows = db.prepare(`
        SELECT * FROM messages
        WHERE account_id = ? AND thread_id = ? AND (? IS NULL OR event_time < ?)
        ORDER BY event_time DESC, id DESC LIMIT ?`)
        .all(accountId, threadId, before, before, Math.min(Number(limit), 2000));
      return rows.reverse().map(decMessage);
    },

    /** Duyệt lần lượt (không nạp hết vào RAM) mọi tin của một hội thoại trong khoảng — dùng cho xuất. */
    *iterateMessages(accountId, threadId, from = null, to = null) {
      const it = db.prepare(`
        SELECT * FROM messages
        WHERE account_id = ? AND thread_id = ?
          AND (? IS NULL OR event_time >= ?) AND (? IS NULL OR event_time < ?)
        ORDER BY event_time ASC, id ASC`)
        .iterate(accountId, threadId, from, from, to, to);
      for (const r of it) yield decMessage(r);
    },

    stats(accountIds = null) {
      const accWhere = accountIds?.length
        ? `account_id IN (${accountIds.map((_, i) => `@a${i}`).join(',')})` : '1=1';
      const params = {};
      accountIds?.forEach((id, i) => { params[`a${i}`] = id; });
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const conv = db.prepare(`
        SELECT COUNT(*) AS conversations,
               SUM(CASE WHEN last_message_outbound = 0 AND is_group = 0 THEN 1 ELSE 0 END) AS waiting,
               SUM(CASE WHEN is_group = 1 THEN 1 ELSE 0 END) AS groups,
               SUM(unread_count) AS unread,
               SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unread_conversations,
               MAX(last_message_at) AS last_message_at
        FROM conversations WHERE ${accWhere}`).get(params);
      const msg = db.prepare(`
        SELECT COUNT(*) AS messages,
               SUM(CASE WHEN event_time >= @today THEN 1 ELSE 0 END) AS today
        FROM messages WHERE ${accWhere}`).get({ ...params, today: startOfToday.getTime() });
      return { ...conv, ...msg };
    },

    // ── Danh bạ ───────────────────────────────────────────────────────────────
    upsertContacts(accountId, contacts) {
      const now = Date.now();
      const tx = db.transaction((list) => {
        for (const c of list) {
          st.upsertContact.run({
            account_id: accountId,
            user_id: String(c.userId ?? ''),
            display_name: enc(c.displayName ?? null),
            zalo_name: enc(c.zaloName ?? null),
            avatar_url: enc(c.avatar ?? null),
            phone: enc(c.phoneNumber ?? null),
            now,
          });
        }
        st.fillConversationsFromContacts.run(accountId);
      });
      tx(contacts.filter((c) => c?.userId));
    },
    getContact(accountId, userId) { return decRow(st.getContact.get(accountId, userId), ENC.contacts); },

    // ── Báo cáo ngày ─────────────────────────────────────────────────────────
    /** Hội thoại có tin trong [from, to) kèm số tin mỗi chiều — dùng cho báo cáo ngày. */
    activityByRange(from, to) {
      const rows = db.prepare(`
        SELECT c.*, a.total, a.inbound, a.outbound, a.first_at, a.last_at
        FROM (SELECT account_id, thread_id, COUNT(*) total, SUM(CASE WHEN is_outbound=0 THEN 1 ELSE 0 END) inbound, SUM(CASE WHEN is_outbound=1 THEN 1 ELSE 0 END) outbound, MIN(event_time) first_at, MAX(event_time) last_at
              FROM messages WHERE event_time >= ? AND event_time < ? GROUP BY account_id, thread_id) a
        JOIN conversations c ON c.account_id = a.account_id AND c.thread_id = a.thread_id
        ORDER BY a.last_at DESC`).all(from, to).map(decConversation);
      const totals = rows.reduce((t, r) => ({ messages: t.messages + r.total, inbound: t.inbound + r.inbound, outbound: t.outbound + r.outbound }), { messages: 0, inbound: 0, outbound: 0 });
      return { rows, totals };
    },
    /** Các ngày (giờ VN, yyyy-mm-dd) có tin trong N ngày gần nhất. */
    activeDays(days = 45) {
      const since = Date.now() - days * 86400e3;
      const rows = db.prepare(`SELECT DISTINCT date(event_time / 1000 + 7 * 3600, 'unixepoch') AS d FROM messages WHERE event_time >= ? ORDER BY d DESC`).all(since);
      return rows.map((r) => r.d);
    },

    // ── Cảm xúc (reaction) ───────────────────────────────────────────────────
    /** icon rỗng = gỡ cảm xúc. Trả true nếu có thay đổi. */
    setReaction({ accountId, threadId, msgId, reactorId, icon, ts }) {
      if (!msgId || !reactorId) return false;
      if (!icon) return st.deleteReaction.run(accountId, threadId, String(msgId), String(reactorId)).changes > 0;
      st.upsertReaction.run({ account_id: accountId, thread_id: threadId, msg_id: String(msgId), reactor_id: String(reactorId), icon: enc(icon), ts: Number(ts) || Date.now() });
      return true;
    },
    /** Cảm xúc của một loạt tin: { msgId → [{ icon, count, mine }] } — gom theo icon. */
    reactionsForMessages(accountId, threadId, msgIds, selfId) {
      if (!msgIds.length) return {};
      const out = {};
      for (let i = 0; i < msgIds.length; i += 400) {
        const chunk = msgIds.slice(i, i + 400);
        const rows = db.prepare(`SELECT msg_id, reactor_id, icon FROM reactions WHERE account_id = ? AND thread_id = ? AND msg_id IN (${chunk.map(() => '?').join(',')})`).all(accountId, threadId, ...chunk);
        for (const r of rows) {
          const icon = dec(r.icon); if (!icon) continue;
          const list = (out[r.msg_id] ||= []);
          let e = list.find((x) => x.icon === icon); if (!e) { e = { icon, count: 0, mine: false }; list.push(e); }
          e.count++; if (r.reactor_id === selfId) e.mine = true;
        }
      }
      return out;
    },

    // ── Mã hoá lại ───────────────────────────────────────────────────────────
    /** Số dòng còn giá trị chưa mã hoá hoặc mã hoá bằng phiên bản khác phiên bản hiện tại. */
    countNeedingReencrypt() {
      if (!cipher?.ready) return 0;
      const v = `enc:v${cipher.version}:%`;
      let n = 0;
      for (const [table, cols] of Object.entries(ENC)) {
        const cond = cols.map((c) => `(${c} IS NOT NULL AND ${c} NOT LIKE @v)`).join(' OR ');
        n += db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${cond}`).get({ v }).n;
      }
      return n;
    },
    /**
     * Mã hoá lại mọi dòng chưa ở phiên bản hiện tại — theo lô 300 dòng/transaction, nhường event loop giữa các lô.
     * Chạy lại bao nhiêu lần cũng được (dòng đã đúng phiên bản bị bỏ qua). onProgress({ table, done, total }).
     */
    async reencryptAll({ onProgress } = {}) {
      if (!cipher?.ready) throw new Error('Chưa mở khoá mã hoá.');
      const v = `enc:v${cipher.version}:%`;
      const summary = {};
      for (const [table, cols] of Object.entries(ENC)) {
        const pk = table === 'messages' ? ['id'] : table === 'conversations' ? ['account_id', 'thread_id'] : table === 'reactions' ? ['account_id', 'thread_id', 'msg_id', 'reactor_id'] : ['account_id', 'user_id'];
        const cond = cols.map((c) => `(${c} IS NOT NULL AND ${c} NOT LIKE @v)`).join(' OR ');
        const total = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${cond}`).get({ v }).n;
        const select = db.prepare(`SELECT ${[...pk, ...cols].join(', ')} FROM ${table} WHERE ${cond} LIMIT 300`);
        const update = db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE ${pk.map((k) => `${k} = @${k}`).join(' AND ')}`);
        const batch = db.transaction((rows) => { for (const r of rows) { const next = { ...r }; for (const c of cols) next[c] = r[c] === null ? null : enc(dec(r[c])); update.run(next); } });
        let done = 0;
        for (let guard = 0; guard < 100000; guard++) {
          const rows = select.all({ v });
          if (!rows.length) break;
          // Dòng có khoá thiếu → dec trả chuỗi đánh dấu → sẽ bị mã hoá thành chuỗi đó. Tránh: bỏ qua dòng không giải mã được.
          const ok = rows.filter((r) => cols.every((c) => r[c] === null || cipher.hasVersion(versionOf(r[c]))));
          if (!ok.length) break;   // toàn dòng thiếu khoá — dừng, không phá dữ liệu
          batch(ok);
          done += ok.length;
          onProgress?.({ table, done, total });
          if (ok.length < rows.length) break;
          await new Promise((r) => setImmediate(r));
        }
        summary[table] = { done, total };
      }
      return summary;
    },

    // ── Lịch sử xuất ──────────────────────────────────────────────────────────
    recordExport({ format, dir, conversations, messages, params }) {
      st.insertExport.run(Date.now(), format, dir, conversations, messages, JSON.stringify(params ?? {}));
    },
    listExports() { return st.listExports.all(); },

    /** Xoá TOÀN BỘ dữ liệu hội thoại (đổi danh tính / thoát chế độ dùng thử). Phiên Zalo trong sessions/ không nằm trong DB. */
    resetAll() {
      db.transaction(() => { for (const t of ['reactions', 'messages', 'conversations', 'contacts', 'exports', 'accounts']) db.exec(`DELETE FROM ${t}`); })();
      try { db.exec('VACUUM'); } catch { /* bỏ qua */ }
    },
    close() { db.close(); },
  };
}
