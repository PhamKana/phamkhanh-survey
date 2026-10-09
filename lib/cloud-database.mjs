import { createClient } from '@libsql/client/web';
import { schema } from './schema.mjs';
import { hashPassword, tokenHash } from './database.mjs';
import { seedSurvey, upgradeLegacySurvey } from './seed.mjs';

export function cloudSettings(env = process.env) {
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('Cần đặt TURSO_DATABASE_URL và TURSO_AUTH_TOKEN trong Vercel Environment Variables.');
  const parsed = new URL(url);
  if (!['libsql:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('TURSO_DATABASE_URL phải là URL libsql:// hoặc https:// của database online.');
  return { url, authToken };
}

export function adaptClient(client) {
  return {
    prepare(sql) {
      const execute = args => client.execute({ sql, args });
      return {
        async get(...args) { return (await execute(args)).rows[0]; },
        async all(...args) { return (await execute(args)).rows; },
        async run(...args) { const result = await execute(args); return { changes: result.rowsAffected }; },
      };
    },
    async batch(statements) {
      return (await client.batch(statements, 'write')).map(result => ({ changes: result.rowsAffected }));
    },
    async consumeRateLimit(key, limit, window) {
      const now = Date.now();
      // Atomic across every Vercel instance. Only hashed bucket identifiers persist.
      const results = await client.batch([
        { sql: 'DELETE FROM rate_limits WHERE expires<=?', args: [now] },
        { sql: `INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?)
            ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count`, args: [tokenHash(key), now + window] },
      ], 'write');
      return Number(results[1].rows[0].count) <= limit;
    },
    close() { client.close(); },
  };
}

export async function initializeCloudDatabase(db, env = process.env) {
  await db.batch(schema.map(sql => ({ sql })));
  if (!await db.prepare('SELECT id FROM admins LIMIT 1').get()) {
    const password = env.ADMIN_INITIAL_PASSWORD;
    const username = env.ADMIN_USERNAME || 'admin';
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Lần khởi tạo đầu tiên cần ADMIN_INITIAL_PASSWORD từ 12 đến 256 ký tự.');
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw new Error('ADMIN_USERNAME chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới (tối đa 64 ký tự).');
    await db.prepare('INSERT INTO admins(id,username,password_hash) SELECT 1,?,? WHERE NOT EXISTS (SELECT 1 FROM admins) ON CONFLICT DO NOTHING').run(username, hashPassword(password));
  }
  await db.prepare('INSERT INTO surveys(id,slug,config,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM surveys) ON CONFLICT DO NOTHING').run('genai', 'genai', JSON.stringify(seedSurvey), new Date().toISOString());
  for (const row of await db.prepare('SELECT id,config FROM surveys').all()) {
    const config = JSON.parse(row.config), updated = upgradeLegacySurvey(config);
    if (updated !== config) await db.prepare('UPDATE surveys SET config=?,version=version+1 WHERE id=? AND config=?').run(JSON.stringify(updated), row.id, row.config);
  }
  return db;
}

export async function openCloudDatabase(env = process.env) {
  const client = createClient(cloudSettings(env));
  const db = adaptClient(client);
  try { return await initializeCloudDatabase(db, env); }
  catch (error) { db.close(); throw error; }
}
