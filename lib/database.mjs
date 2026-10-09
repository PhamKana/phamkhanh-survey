import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { seedSurvey, upgradeLegacySurvey } from './seed.mjs';
import { schema } from './schema.mjs';
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function openDatabase(dataDir, initialPassword) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'survey.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(schema.join(';') + '; PRAGMA optimize;');
  if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
    const password = initialPassword || randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO admins(username,password_hash) VALUES (?,?)').run('admin', hashPassword(password));
    if (!initialPassword) writeFileSync(join(dataDir, 'admin-first-login.txt'), `SURVEY STUDIO — Tài khoản quản trị ban đầu\r\n\r\nĐịa chỉ: http://localhost:3000/admin\r\nTên đăng nhập: admin\r\nMật khẩu: ${password}\r\n\r\nĐổi mật khẩu trong mục Tài khoản sau lần đăng nhập đầu tiên.\r\nFile này được xoá tự động sau khi đổi mật khẩu. Không chia sẻ file này.\r\n`, { mode: 0o600 });
  }
  if (!db.prepare('SELECT id FROM surveys LIMIT 1').get()) db.prepare('INSERT INTO surveys(id,slug,config,created_at) VALUES (?,?,?,?)').run('genai', 'genai', JSON.stringify(seedSurvey), new Date().toISOString());
  for(const row of db.prepare('SELECT id,config FROM surveys').all()){
    const config=JSON.parse(row.config),updated=upgradeLegacySurvey(config);
    if(updated!==config)db.prepare('UPDATE surveys SET config=?,version=version+1 WHERE id=?').run(JSON.stringify(updated),row.id);
  }
  return db;
}
