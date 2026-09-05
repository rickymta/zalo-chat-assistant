/** SQLite của máy chủ: người dùng, refresh token, mã đặt lại mật khẩu, chuỗi mã hoá theo phiên bản. KHÔNG có bảng tin nhắn. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  replaced_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_refresh_user ON refresh_tokens(user_id);
CREATE TABLE IF NOT EXISTS reset_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS client_keys (
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'server',   -- server | client
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, version)
);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'auth.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  const st = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    insertRefresh: db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    refreshByHash: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
    revokeRefresh: db.prepare('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE token_hash = ?'),
    revokeAllRefresh: db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'),
    insertReset: db.prepare('INSERT INTO reset_codes (user_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    activeResets: db.prepare('SELECT * FROM reset_codes WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC'),
    bumpResetAttempts: db.prepare('UPDATE reset_codes SET attempts = attempts + 1 WHERE id = ?'),
    useReset: db.prepare('UPDATE reset_codes SET used_at = ? WHERE id = ?'),
    currentKey: db.prepare('SELECT * FROM client_keys WHERE user_id = ? ORDER BY version DESC LIMIT 1'),
    allKeys: db.prepare('SELECT version, key, source, created_at FROM client_keys WHERE user_id = ? ORDER BY version DESC'),
    insertKey: db.prepare('INSERT INTO client_keys (user_id, version, key, source, created_at) VALUES (?, ?, ?, ?, ?)'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  };

  return {
    raw: db,
    userByEmail: (e) => st.userByEmail.get(String(e).trim().toLowerCase()),
    userById: (id) => st.userById.get(id),
    createUser({ id, email, name, passwordHash }) {
      const now = Date.now();
      st.insertUser.run(id, String(email).trim().toLowerCase(), name ?? null, passwordHash, now, now);
      return st.userById.get(id);
    },
    setPassword: (id, hash) => st.setPassword.run(hash, Date.now(), id),
    touchLogin: (id) => st.touchLogin.run(Date.now(), id),
    insertRefresh: (userId, tokenHash, device, expiresAt) => st.insertRefresh.run(userId, tokenHash, device ?? null, Date.now(), expiresAt),
    refreshByHash: (h) => st.refreshByHash.get(h),
    revokeRefresh: (h, replacedBy = null) => st.revokeRefresh.run(Date.now(), replacedBy, h),
    revokeAllRefresh: (userId) => st.revokeAllRefresh.run(Date.now(), userId),
    insertReset: (userId, codeHash, expiresAt) => st.insertReset.run(userId, codeHash, Date.now(), expiresAt),
    activeResets: (userId) => st.activeResets.all(userId, Date.now()),
    bumpResetAttempts: (id) => st.bumpResetAttempts.run(id),
    useReset: (id) => st.useReset.run(Date.now(), id),
    currentKey: (userId) => st.currentKey.get(userId),
    allKeys: (userId) => st.allKeys.all(userId),
    /** Thêm phiên bản khoá mới (version = hiện tại + 1) trong transaction. */
    addKey(userId, key, source) {
      return db.transaction(() => {
        const cur = st.currentKey.get(userId);
        const version = (cur?.version ?? 0) + 1;
        st.insertKey.run(userId, version, key, source, Date.now());
        return { version, key, source };
      })();
    },
    countUsers: () => st.countUsers.get().n,
    close: () => db.close(),
  };
}
