import { neon } from '@neondatabase/serverless';
import { schema } from './schema.mjs';
import { hashPassword, tokenHash } from './database.mjs';
import { seedSurvey, upgradeLegacySurvey } from './seed.mjs';
import { SetupError } from './setup-errors.mjs';

export function cloudSettings(env = process.env) {
  const url = (env.DATABASE_URL || env.POSTGRES_URL)?.trim();
  if (!url) throw new SetupError('DATABASE_CONFIG_MISSING', 'Chưa gắn database: vào Vercel → Storage, tạo Neon Postgres rồi Connect Project với project này. Vercel sẽ thêm DATABASE_URL tự động; sau đó Redeploy.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new SetupError('DATABASE_URL_INVALID', 'DATABASE_URL không hợp lệ. Kết nối lại Neon Postgres với project trong Vercel Storage rồi Redeploy.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.username || !parsed.password || !/(^|\.)neon\.tech$/i.test(parsed.hostname) || parsed.pathname.length < 2) throw new SetupError('DATABASE_URL_INVALID', 'Cần DATABASE_URL của Neon Postgres tạo qua Vercel Storage. Gắn đúng database với project rồi Redeploy.');
  return { url };
}

// App queries use positional '?' parameters; values always travel separately.
export function postgresQuery(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? `$${++index}` : token);
}

export function createNeonClient(sql) {
  return {
    execute({ sql: text, args = [] }) { return sql.query(text, args, { fullResults: true }); },
    batch(statements) { return sql.transaction(statements.map(({ sql: text, args = [] }) => sql.query(text, args)), { fullResults: true }); },
  };
}

function rows(result) {
  return result.rows.map(row => {
    const value = { ...row };
    // PostgreSQL COUNT and BIGINT values may be strings in the HTTP driver.
    for (const key of ['n', 'total', 'eligible', 'expires']) if (value[key] !== undefined) value[key] = Number(value[key]);
    return value;
  });
}

export function adaptClient(client) {
  return {
    jsonStatusExpression: "(config::jsonb->>'status')",
    prepare(sql) {
      const execute = args => client.execute({ sql: postgresQuery(sql), args });
      return {
        async get(...args) { return rows(await execute(args))[0]; },
        async all(...args) { return rows(await execute(args)); },
        async run(...args) { const result = await execute(args); return { changes: result.rowCount }; },
      };
    },
    async batch(statements) {
      return (await client.batch(statements.map(({ sql, args }) => ({ sql: postgresQuery(sql), args })))).map(result => ({ changes: result.rowCount }));
    },
    async consumeRateLimit(key, limit, window) {
      const now = Date.now();
      // Atomic across every Vercel instance. Only hashed bucket identifiers persist.
      const results = await client.batch([
        { sql: 'DELETE FROM rate_limits WHERE expires<=$1', args: [now] },
        { sql: `INSERT INTO rate_limits(key,count,expires) VALUES ($1,1,$2)
            ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count`, args: [tokenHash(key), now + window] },
      ]);
      return Number(results[1].rows[0].count) <= limit;
    },
    close() { client.close?.(); },
  };
}

export async function initializeCloudDatabase(db, env = process.env) {
  // Serialize cold-start schema creation in PostgreSQL's shared database.
  await db.batch([
    { sql: 'SELECT pg_advisory_xact_lock(736871241)' },
    ...schema.map(sql => ({ sql: sql.replaceAll('expires INTEGER', 'expires BIGINT') })),
  ]);
  if (!await db.prepare('SELECT id FROM admins LIMIT 1').get()) {
    const password = env.ADMIN_INITIAL_PASSWORD;
    const username = env.ADMIN_USERNAME || 'admin';
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new SetupError('ADMIN_PASSWORD_MISSING_OR_INVALID', 'Database đã kết nối nhưng chưa tạo tài khoản admin. Đặt ADMIN_INITIAL_PASSWORD từ 12 đến 256 ký tự trong Vercel Environment Variables rồi Redeploy.');
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw new SetupError('ADMIN_USERNAME_INVALID', 'ADMIN_USERNAME chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới (tối đa 64 ký tự).');
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
  const client = createNeonClient(neon(cloudSettings(env).url));
  const db = adaptClient(client);
  try { return await initializeCloudDatabase(db, env); }
  catch (error) { db.close(); throw error; }
}
