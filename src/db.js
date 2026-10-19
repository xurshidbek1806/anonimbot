import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      username TEXT,
      joined_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS links (
      token TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL CHECK(mode IN ('anonymous', 'open_sender')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS links_owner_idx ON links(owner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_token TEXT NOT NULL REFERENCES links(token),
      visitor_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      UNIQUE(link_token, visitor_id)
    );
    CREATE TABLE IF NOT EXISTS contexts (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      kind TEXT NOT NULL,
      target TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_drafts (
      admin_id TEXT PRIMARY KEY REFERENCES users(id),
      source_message_id INTEGER,
      button_label TEXT,
      button_url TEXT
    );
    CREATE TABLE IF NOT EXISTS broadcast_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_admin_id TEXT NOT NULL,
      source_message_id INTEGER NOT NULL,
      button_label TEXT,
      button_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS broadcast_deliveries (
      job_id INTEGER NOT NULL REFERENCES broadcast_jobs(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
      PRIMARY KEY(job_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS broadcast_job_kinds (
      job_id INTEGER PRIMARY KEY REFERENCES broadcast_jobs(id),
      kind TEXT NOT NULL CHECK(kind IN ('announcement', 'sponsored'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      login TEXT UNIQUE,
      auto_reply TEXT,
      ads_opt_in INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS personal_links (
      owner_id TEXT PRIMARY KEY REFERENCES users(id),
      link_token TEXT NOT NULL UNIQUE REFERENCES links(token)
    );
    CREATE TABLE IF NOT EXISTS link_visits (
      owner_id TEXT NOT NULL REFERENCES users(id),
      link_token TEXT NOT NULL REFERENCES links(token),
      visitor_id TEXT NOT NULL REFERENCES users(id),
      day INTEGER NOT NULL,
      visited_at INTEGER NOT NULL,
      PRIMARY KEY(link_token, visitor_id, day)
    );
    CREATE INDEX IF NOT EXISTS link_visits_owner_idx ON link_visits(owner_id, visited_at);
    CREATE TABLE IF NOT EXISTS incoming_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL REFERENCES users(id),
      link_token TEXT NOT NULL REFERENCES links(token),
      visitor_id TEXT NOT NULL REFERENCES users(id),
      sent_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS incoming_messages_owner_idx ON incoming_messages(owner_id, sent_at);
    CREATE TABLE IF NOT EXISTS blocked_conversations (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function createStore(db) {
  const now = () => Math.floor(Date.now() / 1000);
  return {
    upsertUser(user) {
      db.prepare(`INSERT INTO users(id, first_name, username, joined_at, last_seen_at, blocked)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,
          username=excluded.username, last_seen_at=excluded.last_seen_at, blocked=0`)
        .run(String(user.id), user.first_name || '', user.username || null, now(), now());
    },
    getUser(id) {
      return db.prepare('SELECT * FROM users WHERE id=?').get(String(id));
    },
    createLink(ownerId, mode) {
      if (!['anonymous', 'open_sender'].includes(mode)) throw new Error('Invalid mode');
      const token = randomBytes(8).toString('hex');
      db.prepare('INSERT INTO links(token, owner_id, mode, created_at) VALUES (?, ?, ?, ?)')
        .run(token, String(ownerId), mode, now());
      return this.getLink(token);
    },
    getLink(token) {
      return db.prepare('SELECT * FROM links WHERE token=?').get(token);
    },
    getOrCreatePersonalLink(ownerId) {
      let link = db.prepare(`SELECT l.* FROM personal_links p JOIN links l ON l.token=p.link_token
        WHERE p.owner_id=?`).get(String(ownerId));
      if (link?.active) return link;
      link = this.createLink(ownerId, 'anonymous');
      db.prepare(`INSERT INTO personal_links(owner_id, link_token) VALUES (?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET link_token=excluded.link_token`)
        .run(String(ownerId), link.token);
      return link;
    },
    setPersonalLinkMode(ownerId, mode) {
      if (!['anonymous', 'open_sender'].includes(mode)) throw new Error('Invalid mode');
      const link = this.getOrCreatePersonalLink(ownerId);
      db.prepare('UPDATE links SET mode=? WHERE token=? AND owner_id=?')
        .run(mode, link.token, String(ownerId));
      return this.getLink(link.token);
    },
    resolveStartParameter(parameter) {
      const directLink = this.getLink(parameter);
      if (directLink) return directLink;
      if (parameter.startsWith('p_')) {
        const legacyLink = db.prepare(`SELECT l.* FROM user_settings s
          JOIN personal_links p ON p.owner_id=s.user_id
          JOIN links l ON l.token=p.link_token
          WHERE s.login=? COLLATE NOCASE`).get(parameter.slice(2));
        if (legacyLink) return legacyLink;
      }
      return db.prepare(`SELECT l.* FROM user_settings s
        JOIN personal_links p ON p.owner_id=s.user_id
        JOIN links l ON l.token=p.link_token
        WHERE s.login=? COLLATE NOCASE`).get(parameter);
    },
    setLogin(userId, login) {
      if (db.prepare('SELECT 1 FROM links WHERE token=? COLLATE NOCASE').get(login) ||
        db.prepare(`SELECT 1 FROM user_settings
        WHERE login=? COLLATE NOCASE AND user_id<>?`).get(login, String(userId))) {
        const error = new Error('Login is taken');
        error.code = 'LOGIN_TAKEN';
        throw error;
      }
      db.prepare(`INSERT INTO user_settings(user_id, login) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET login=excluded.login`)
        .run(String(userId), login);
    },
    getSettings(userId) {
      return db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(String(userId)) || null;
    },
    setAutoReply(userId, text) {
      db.prepare(`INSERT INTO user_settings(user_id, auto_reply) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET auto_reply=excluded.auto_reply`)
        .run(String(userId), text);
    },
    setAdsOptIn(userId, enabled) {
      db.prepare(`INSERT INTO user_settings(user_id, ads_opt_in) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET ads_opt_in=excluded.ads_opt_in`)
        .run(String(userId), enabled ? 1 : 0);
    },
    recordVisit(ownerId, linkToken, visitorId) {
      const time = now();
      db.prepare(`INSERT OR IGNORE INTO link_visits(owner_id, link_token, visitor_id, day, visited_at)
        VALUES (?, ?, ?, ?, ?)`).run(String(ownerId), linkToken, String(visitorId),
        Math.floor(time / 86400), time);
    },
    recordIncomingMessage(ownerId, linkToken, visitorId) {
      db.prepare(`INSERT INTO incoming_messages(owner_id, link_token, visitor_id, sent_at)
        VALUES (?, ?, ?, ?)`).run(String(ownerId), linkToken, String(visitorId), now());
    },
    profileStats(ownerId) {
      const windows = [
        ['24 soat', 86400], ['7 kun', 7 * 86400], ['30 kun', 30 * 86400],
      ];
      return windows.map(([label, seconds]) => ({
        label,
        visitors: db.prepare(`SELECT COUNT(DISTINCT visitor_id) AS n FROM link_visits
          WHERE owner_id=? AND visited_at>=?`).get(String(ownerId), now() - seconds).n,
        messages: db.prepare(`SELECT COUNT(*) AS n FROM incoming_messages
          WHERE owner_id=? AND sent_at>=?`).get(String(ownerId), now() - seconds).n,
      }));
    },
    blockConversation(conversationId, ownerId) {
      const c = this.getConversation(conversationId);
      if (!c || c.owner_id !== String(ownerId)) return false;
      db.prepare(`INSERT OR IGNORE INTO blocked_conversations(conversation_id, owner_id, created_at)
        VALUES (?, ?, ?)`).run(c.id, String(ownerId), now());
      return true;
    },
    unblockConversation(conversationId, ownerId) {
      return db.prepare('DELETE FROM blocked_conversations WHERE conversation_id=? AND owner_id=?')
        .run(Number(conversationId), String(ownerId)).changes > 0;
    },
    unblockAllConversations(ownerId) {
      return db.prepare('DELETE FROM blocked_conversations WHERE owner_id=?')
        .run(String(ownerId)).changes;
    },
    isConversationBlocked(conversationId) {
      return Boolean(db.prepare('SELECT 1 FROM blocked_conversations WHERE conversation_id=?')
        .get(Number(conversationId)));
    },
    listBlockedConversations(ownerId, offset = 0, limit = 11) {
      return db.prepare(`SELECT c.id
        FROM blocked_conversations b JOIN conversations c ON c.id=b.conversation_id
        WHERE b.owner_id=? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`)
        .all(String(ownerId), limit, offset);
    },
    listLinks(ownerId, offset = 0, limit = 11) {
      return db.prepare('SELECT * FROM links WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
        .all(String(ownerId), limit, offset);
    },
    deactivateLink(token, ownerId) {
      return db.prepare('UPDATE links SET active=0 WHERE token=? AND owner_id=?')
        .run(token, String(ownerId)).changes > 0;
    },
    getOrCreateConversation(token, visitorId) {
      let conversation = db.prepare('SELECT * FROM conversations WHERE link_token=? AND visitor_id=?')
        .get(token, String(visitorId));
      if (conversation) return { conversation, isNew: false };
      db.prepare('INSERT INTO conversations(link_token, visitor_id, created_at) VALUES (?, ?, ?)')
        .run(token, String(visitorId), now());
      conversation = db.prepare('SELECT * FROM conversations WHERE link_token=? AND visitor_id=?')
        .get(token, String(visitorId));
      return { conversation, isNew: true };
    },
    getConversation(id) {
      return db.prepare(`SELECT c.*, l.owner_id, l.mode, l.active FROM conversations c
        JOIN links l ON l.token=c.link_token WHERE c.id=?`).get(Number(id));
    },
    setContext(userId, kind, target = null) {
      db.prepare(`INSERT INTO contexts(user_id, kind, target, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind, target=excluded.target,
          updated_at=excluded.updated_at`).run(String(userId), kind, target === null ? null : String(target), now());
    },
    getContext(userId) {
      return db.prepare('SELECT * FROM contexts WHERE user_id=?').get(String(userId));
    },
    clearContext(userId) {
      db.prepare('DELETE FROM contexts WHERE user_id=?').run(String(userId));
    },
    stats() {
      return {
        users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        activeUsers: db.prepare('SELECT COUNT(*) AS n FROM users WHERE blocked=0').get().n,
        links: db.prepare('SELECT COUNT(*) AS n FROM links WHERE active=1').get().n,
        conversations: db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,
      };
    },
    saveDraft(adminId, messageId) {
      db.prepare(`INSERT INTO admin_drafts(admin_id, source_message_id) VALUES (?, ?)
        ON CONFLICT(admin_id) DO UPDATE SET source_message_id=excluded.source_message_id,
          button_label=NULL, button_url=NULL`).run(String(adminId), messageId);
    },
    getDraft(adminId) {
      return db.prepare('SELECT * FROM admin_drafts WHERE admin_id=?').get(String(adminId));
    },
    setDraftButton(adminId, label, url) {
      db.prepare('UPDATE admin_drafts SET button_label=?, button_url=? WHERE admin_id=?')
        .run(label, url, String(adminId));
    },
    clearDraft(adminId) {
      db.prepare('DELETE FROM admin_drafts WHERE admin_id=?').run(String(adminId));
    },
    createBroadcast(adminId, kind = 'announcement') {
      const draft = this.getDraft(adminId);
      if (!draft?.source_message_id) return null;
      if (!['announcement', 'sponsored'].includes(kind)) throw new Error('Invalid broadcast kind');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare(`INSERT INTO broadcast_jobs
          (source_admin_id, source_message_id, button_label, button_url, created_at)
          VALUES (?, ?, ?, ?, ?)`).run(String(adminId), draft.source_message_id,
          draft.button_label, draft.button_url, now());
        const jobId = Number(result.lastInsertRowid);
        db.prepare('INSERT INTO broadcast_job_kinds(job_id, kind) VALUES (?, ?)').run(jobId, kind);
        this.clearDraft(adminId);
        db.exec('COMMIT');
        return jobId;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    pendingJobs() {
      return db.prepare(`SELECT j.*, COALESCE(k.kind, 'announcement') AS kind FROM broadcast_jobs j
        LEFT JOIN broadcast_job_kinds k ON k.job_id=j.id
        WHERE j.status IN ('pending','running') ORDER BY j.id`).all();
    },
    nextBroadcastUser(jobId, kind = 'announcement') {
      return db.prepare(`SELECT u.id FROM users u LEFT JOIN broadcast_deliveries d
        ON d.user_id=u.id AND d.job_id=? LEFT JOIN user_settings s ON s.user_id=u.id
        WHERE d.user_id IS NULL AND u.blocked=0
        AND (?='announcement' OR COALESCE(s.ads_opt_in,0)=1)
        ORDER BY u.joined_at, u.id LIMIT 1`).get(jobId, kind);
    },
    markJobRunning(jobId) {
      db.prepare("UPDATE broadcast_jobs SET status='running' WHERE id=?").run(jobId);
    },
    markDelivery(jobId, userId, status) {
      db.prepare('INSERT OR IGNORE INTO broadcast_deliveries(job_id, user_id, status) VALUES (?, ?, ?)')
        .run(jobId, String(userId), status);
    },
    markBlocked(userId) {
      db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(String(userId));
    },
    finishJob(jobId) {
      db.prepare("UPDATE broadcast_jobs SET status='done', finished_at=? WHERE id=?").run(now(), jobId);
    },
    jobStats(jobId) {
      return db.prepare(`SELECT status, COUNT(*) AS n FROM broadcast_deliveries
        WHERE job_id=? GROUP BY status`).all(jobId);
    },
    getOffset() {
      return Number(db.prepare("SELECT value FROM settings WHERE key='update_offset'").get()?.value || 0);
    },
    setOffset(offset) {
      db.prepare(`INSERT INTO settings(key, value) VALUES ('update_offset', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(offset));
    },
  };
}
