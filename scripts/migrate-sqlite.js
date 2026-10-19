import { DatabaseSync } from 'node:sqlite';
import { openPostgres } from '../src/postgres.js';

const sourcePath = process.env.SQLITE_SOURCE;
const databaseUrl = process.env.DATABASE_URL;
if (!sourcePath || !databaseUrl) {
  throw new Error('SQLITE_SOURCE va DATABASE_URL kerak.');
}

const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
const pool = await openPostgres(databaseUrl);
const client = await pool.connect();

const tables = [
  ['users', ['id', 'first_name', 'username', 'joined_at', 'last_seen_at', 'blocked']],
  ['links', ['token', 'owner_id', 'mode', 'active', 'created_at']],
  ['conversations', ['id', 'link_token', 'visitor_id', 'created_at']],
  ['contexts', ['user_id', 'kind', 'target', 'updated_at']],
  ['admin_drafts', ['admin_id', 'source_message_id', 'button_label', 'button_url']],
  ['broadcast_jobs', ['id', 'source_admin_id', 'source_message_id', 'button_label', 'button_url', 'status', 'created_at', 'finished_at']],
  ['broadcast_deliveries', ['job_id', 'user_id', 'status']],
  ['broadcast_job_kinds', ['job_id', 'kind']],
  ['settings', ['key', 'value']],
  ['user_settings', ['user_id', 'login', 'auto_reply', 'ads_opt_in']],
  ['personal_links', ['owner_id', 'link_token']],
  ['link_visits', ['owner_id', 'link_token', 'visitor_id', 'day', 'visited_at']],
  ['incoming_messages', ['id', 'owner_id', 'link_token', 'visitor_id', 'sent_at']],
  ['blocked_conversations', ['conversation_id', 'owner_id', 'created_at']],
];
const boolColumns = new Set(['users.blocked', 'links.active', 'user_settings.ads_opt_in']);

try {
  await client.query('BEGIN');
  const existing = (await client.query('SELECT COUNT(*) AS n FROM users')).rows[0].n;
  if (Number(existing) !== 0) throw new Error('Maqsad PostgreSQL bazasi bo‘sh emas; migratsiya to‘xtatildi.');

  for (const [table, columns] of tables) {
    const rows = sqlite.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const query = `INSERT INTO ${table}(${columns.join(', ')}) VALUES (${placeholders})`;
    for (const row of rows) {
      const values = columns.map((column) => {
        const value = row[column];
        return boolColumns.has(`${table}.${column}`) ? Boolean(value) : value;
      });
      await client.query(query, values);
    }
    console.log(`${table}: ${rows.length}`);
  }

  for (const table of ['conversations', 'broadcast_jobs', 'incoming_messages']) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1),
      EXISTS(SELECT 1 FROM ${table}))`);
  }
  await client.query('COMMIT');
  console.log('SQLite → PostgreSQL migratsiyasi yakunlandi.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
}
