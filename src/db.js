/**
 * Kho lưu chính: SQLite (better-sqlite3, chế độ WAL).
 *
 * Vì sao SQLite chứ không phải Excel làm kho gốc: người dùng mục tiêu có HÀNG NGHÌN hội thoại và tin nhắn
 * đến liên tục. Excel không chịu được ghi nối liên tục + chống trùng; SQLite thì một file, không cần cài
 * server, chịu được hàng triệu dòng, và mọi công cụ (kể cả Claude Cowork) đều đọc được. Excel/Markdown
 * chỉ là ĐẦU RA xuất theo yêu cầu (xem src/export/).
 */
import Database from 'better-sqlite3';

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
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

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
         last_message_preview, last_message_outbound, message_count, inbound_count, outbound_count)
      VALUES
        (@account_id, @thread_id, @is_group, @name, @avatar_url, @phone, @event_time, @event_time,
         @preview, @is_outbound, 1, @inbound, @outbound)
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
        message_count  = conversations.message_count + 1,
        inbound_count  = conversations.inbound_count + excluded.inbound_count,
        outbound_count = conversations.outbound_count + excluded.outbound_count`),
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
    const res = st.insertMessage.run(row);
    if (res.changes === 0) return false;
    st.upsertConversation.run({
      account_id: row.account_id,
      thread_id: row.thread_id,
      is_group: row.is_group ? 1 : 0,
      name: row.conv_name ?? null,
      avatar_url: row.conv_avatar ?? null,
      phone: row.conv_phone ?? null,
      event_time: row.event_time,
      preview: row.preview ?? null,
      is_outbound: row.is_outbound ? 1 : 0,
      inbound: row.is_outbound ? 0 : 1,
      outbound: row.is_outbound ? 1 : 0,
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
    if (!p.includeGroups) where.push('c.is_group = 0');
    if (p.onlyWaiting) where.push('c.last_message_outbound = 0');
    if (p.q) {
      where.push(`(c.name LIKE @q OR c.phone LIKE @q OR c.thread_id LIKE @q OR c.last_message_preview LIKE @q)`);
      params.q = `%${p.q}%`;
    }
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

  return {
    raw: db,

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
      st.updateConversationMeta.run(name ?? null, avatarUrl ?? null, phone ?? null, accountId, threadId);
    },
    getConversation(accountId, threadId) { return st.getConversation.get(accountId, threadId); },

    listConversations(p = {}) {
      const { where, params } = conversationFilter(p);
      const limit = Math.min(Number(p.limit ?? 200), 5000);
      const offset = Number(p.offset ?? 0);
      const rows = db.prepare(`
        SELECT c.*, a.display_name AS account_name
        FROM conversations c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE ${where}
        ORDER BY c.last_message_at DESC
        LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset });
      const total = db.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE ${where}`).get(params).n;
      return { rows, total };
    },

    /** Toàn bộ hội thoại khớp bộ lọc (không phân trang) — dùng cho xuất. */
    selectConversationsForExport(p = {}) {
      const { where, params } = conversationFilter(p);
      return db.prepare(`
        SELECT c.*, a.display_name AS account_name
        FROM conversations c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE ${where}
        ORDER BY c.last_message_at DESC`).all(params);
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
    getRecentMessages(accountId, threadId, { limit = 300, before = null } = {}) {
      const rows = db.prepare(`
        SELECT * FROM messages
        WHERE account_id = ? AND thread_id = ? AND (? IS NULL OR event_time < ?)
        ORDER BY event_time DESC, id DESC LIMIT ?`)
        .all(accountId, threadId, before, before, Math.min(Number(limit), 2000));
      return rows.reverse();
    },

    /** Duyệt lần lượt (không nạp hết vào RAM) mọi tin của một hội thoại trong khoảng — dùng cho xuất. */
    iterateMessages(accountId, threadId, from = null, to = null) {
      return db.prepare(`
        SELECT * FROM messages
        WHERE account_id = ? AND thread_id = ?
          AND (? IS NULL OR event_time >= ?) AND (? IS NULL OR event_time < ?)
        ORDER BY event_time ASC, id ASC`)
        .iterate(accountId, threadId, from, from, to, to);
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
               SUM(CASE WHEN last_message_outbound = 0 THEN 1 ELSE 0 END) AS waiting,
               SUM(CASE WHEN is_group = 1 THEN 1 ELSE 0 END) AS groups,
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
            display_name: c.displayName ?? null,
            zalo_name: c.zaloName ?? null,
            avatar_url: c.avatar ?? null,
            phone: c.phoneNumber ?? null,
            now,
          });
        }
        st.fillConversationsFromContacts.run(accountId);
      });
      tx(contacts.filter((c) => c?.userId));
    },
    getContact(accountId, userId) { return st.getContact.get(accountId, userId); },

    // ── Lịch sử xuất ──────────────────────────────────────────────────────────
    recordExport({ format, dir, conversations, messages, params }) {
      st.insertExport.run(Date.now(), format, dir, conversations, messages, JSON.stringify(params ?? {}));
    },
    listExports() { return st.listExports.all(); },

    close() { db.close(); },
  };
}
