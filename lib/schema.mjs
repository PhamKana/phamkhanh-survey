export const schema = [
  'CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS surveys (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL REFERENCES surveys(id), submission_key TEXT NOT NULL, version INTEGER NOT NULL, answers TEXT NOT NULL, meta TEXT NOT NULL, snapshot TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(survey_id,submission_key))',
  'CREATE INDEX IF NOT EXISTS idx_responses_survey_created ON responses(survey_id, created_at DESC)',
  'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires)',
];

// The cloud batch is atomic; local SQLite executes the same statements synchronously.
export async function writeBatch(db, statements) {
  if (db.batch) return db.batch(statements);
  db.exec('BEGIN IMMEDIATE');
  try {
    const results = statements.map(({ sql, args = [] }) => db.prepare(sql).run(...args));
    db.exec('COMMIT');
    return results;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
