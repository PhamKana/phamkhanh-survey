import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { neon, neonConfig } from '@neondatabase/serverless';
import { createServer, request as httpRequest } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { adaptClient, createNeonClient, initializeCloudDatabase, cloudSettings, postgresQuery } from '../lib/cloud-database.mjs';
import { createVercelHandler, deploymentHosts } from '../lib/vercel-handler.mjs';
import { spawnSync } from 'node:child_process';
import { setupDiagnostic } from '../lib/setup-errors.mjs';

const initialPassword = 'initial-cloud-password-2026';
const env = { VERCEL_URL: 'preview.example.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'survey.example', ADMIN_INITIAL_PASSWORD: initialPassword };
function fixture() {
  let pg = new PGlite();
  const previousFetch = neonConfig.fetchFunction;
  // Use the actual Neon HTTP driver, with an isolated Postgres engine as its endpoint.
  // This checks parameter serialization, returned types and atomic transaction batches.
  const execute = async (database, { query, params = [] }) => {
    const result = await database.query(query, params, { rowMode: 'array' });
    return {
      rows: result.rows.map(row => row.map(value => value === null ? null : String(value))),
      fields: result.fields,
      rowCount: result.affectedRows ?? result.rows.length,
      command: query.split(' ')[0], rowAsArray: true,
    };
  };
  neonConfig.fetchFunction = async (_url, options) => {
    const body = JSON.parse(options.body);
    try {
      const result = body.queries ? { results: await pg.transaction(async tx => {
        const results = []; for (const query of body.queries) results.push(await execute(tx, query)); return results;
      }) } : await execute(pg, body);
      return Response.json(result);
    } catch (error) { return Response.json({ message: error.message, code: error.code, constraint: error.constraint, severity: 'ERROR' }, { status: 400 }); }
  };
  const connect = () => adaptClient(createNeonClient(neon('postgresql://test:password@ep-test.neon.tech/neondb')));
  return {
    connect,
    async restart() { const dump = await pg.dumpDataDir(); await pg.close(); pg = await PGlite.create({ loadDataDir: dump }); },
    async cleanup() { neonConfig.fetchFunction = previousFetch; await pg.close(); },
  };
}

test('hosted configuration refuses local storage and untrusted origins', () => {
  assert.throws(() => cloudSettings({}));
  for (const url of ['file:test.sqlite', 'http://example.com', 'https://user:pass@example.com', 'postgresql://user:pass@unsupported.example/db']) assert.throws(() => cloudSettings({ DATABASE_URL: url }));
  const url = 'postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require';
  assert.equal(cloudSettings({ DATABASE_URL: url }).url, url);
  assert.equal(cloudSettings({ POSTGRES_URL: url }).url, url);
  assert.deepEqual(deploymentHosts({ ...env, APP_ORIGIN: 'https://custom.example' }), ['preview.example.vercel.app', 'survey.example', 'custom.example']);
  assert.throws(() => deploymentHosts({ APP_ORIGIN: 'http://custom.example' }));
  assert.throws(() => deploymentHosts({ APP_ORIGIN: 'https://custom.example/path' }));
  assert.throws(() => deploymentHosts({}));
  assert.equal(postgresQuery("SELECT '?' AS literal, ? AS value, 'it''s ?' AS text"), "SELECT '?' AS literal, $1 AS value, 'it''s ?' AS text");
});

test('async database initialization, shared rate limits and atomic rollback', async () => {
  const f = fixture();
  try {
    const first = f.connect();
    await assert.rejects(initializeCloudDatabase(first, {}), error => error.code === 'ADMIN_PASSWORD_MISSING_OR_INVALID');
    await initializeCloudDatabase(first, env);
    const hash = (await first.prepare('SELECT password_hash FROM admins').get()).password_hash;
    const second = await initializeCloudDatabase(f.connect(), { ...env, ADMIN_INITIAL_PASSWORD: 'different-initial-password' });
    assert.equal((await second.prepare('SELECT COUNT(*) AS n FROM admins').get()).n, 1);
    assert.equal((await second.prepare('SELECT COUNT(*) AS n FROM surveys').get()).n, 1);
    assert.equal((await second.prepare('SELECT password_hash FROM admins').get()).password_hash, hash);
    assert.equal(await first.consumeRateLimit('login:192.0.2.1', 2, 60000), true);
    assert.equal(await second.consumeRateLimit('login:192.0.2.1', 2, 60000), true);
    assert.equal(await first.consumeRateLimit('login:192.0.2.1', 2, 60000), false);
    assert(!(await first.prepare('SELECT key FROM rate_limits').get()).key.includes('192.0.2.1'));
    await assert.rejects(first.batch([
      { sql: 'UPDATE surveys SET version=100 WHERE id=?', args: ['genai'] },
      { sql: 'INSERT INTO missing_table VALUES (1)' },
    ]));
    assert.equal((await first.prepare('SELECT version FROM surveys').get()).version, 1);
  } finally { await f.cleanup(); }
});

test('missing setup is explained safely and failed initialization can retry', async () => {
  const missing = () => cloudSettings({});
  assert.throws(missing, error => error.code === 'DATABASE_CONFIG_MISSING' && error.message.includes('DATABASE_URL') && error.message.includes('Vercel'));
  const authError = new Error('sensitive-token-value'); authError.cause = { status: 401 };
  assert.equal(setupDiagnostic(authError).code, 'DATABASE_AUTH_FAILED');
  assert(!JSON.stringify(setupDiagnostic(authError)).includes('sensitive-token-value'));
  assert(!JSON.stringify(setupDiagnostic(new Error('secret-url-value'))).includes('secret-url-value'));
  let attempts = 0;
  const handler = createVercelHandler({ env, openDatabase: async () => { attempts++; cloudSettings({}); } });
  async function invoke(url) {
    const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(text) { this.value = JSON.parse(text); } };
    await handler({ url, method: 'GET', headers: { host: 'survey.example' } }, response);
    return response;
  }
  const health = await invoke('/api/health');
  assert.equal(health.status, 503); assert.equal(health.value.ok, false);
  assert.equal(health.value.code, 'DATABASE_CONFIG_MISSING');
  assert(health.value.error.includes('DATABASE_URL'));
  const publicResult = await invoke('/api/public/surveys/genai');
  assert.equal(attempts, 2); assert.equal(publicResult.status, 503);
  assert(!publicResult.value.error.includes('DATABASE_URL'));
});

test('Vercel handler: private data, parsed bodies, concurrency, password revocation and restart', async () => {
  const f = fixture();
  let opened = 0;
  const openDatabase = async () => { opened++; return initializeCloudDatabase(f.connect(), env); };
  const handlers = [createVercelHandler({ env, openDatabase }), createVercelHandler({ env, openDatabase })];
  let current = 0;
  const server = createServer(async (req, res) => {
    if (req.headers['content-type']?.includes('application/json')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      req.body = JSON.parse(Buffer.concat(chunks).toString());
    }
    await handlers[current++ % handlers.length](req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body, auth, headers = {}) => {
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + path, { method, headers: { Host: 'survey.example', ...(body ? { Origin: 'https://survey.example', 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
          const text = Buffer.concat(chunks).toString(); let value; try { value = JSON.parse(text); } catch { value = text; }
          const responseHeaders = new Headers(); for (const [key, value] of Object.entries(res.headers)) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          resolve({ status: res.statusCode, headers: responseHeaders, value });
        });
      });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  };
  const login = async password => {
    const result = await request('/api/auth/login', 'POST', { username: 'admin', password });
    assert.equal(result.status, 200);
    assert(result.headers.get('set-cookie').includes('Secure'));
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.value.csrf };
  };
  try {
    assert.equal((await request('/admin')).status, 200); assert.equal(opened, 0);
    assert.equal((await request('/s/genai')).status, 200);
    for (const path of ['/data/survey.sqlite', '/.env', '/lib/cloud-database.mjs', '/server.mjs']) assert.equal((await request(path)).status, 404);
    for (const path of ['/api/admin/surveys', '/api/admin/surveys/genai/export', '/api/admin/surveys/genai/responses']) assert.equal((await request(path)).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'admin', password: initialPassword }, null, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/health', 'GET', undefined, null, { Host: 'evil.example' })).status, 403);
    const auth = await login(initialPassword), other = await login(initialPassword);
    const survey = (await request('/api/admin/surveys/genai', 'GET', undefined, auth)).value;
    assert.equal((await request('/api/admin/surveys/genai', 'PUT', survey, { ...auth, csrf: 'wrong' })).status, 403);
    const saves = await Promise.all(['one', 'two'].map(title => request('/api/admin/surveys/genai', 'PUT', { ...survey, title }, auth)));
    assert.deepEqual(saves.map(r => r.status).sort(), [200, 409]);
    const version = saves.find(r => r.status === 200).value.version;
    const createConfig = { ...survey, title: 'Khảo sát Postgres mới', slug: 'neon-created' };
    const creates = await Promise.all(Array.from({ length: 2 }, () => request('/api/admin/surveys', 'POST', createConfig, auth)));
    assert.deepEqual(creates.map(r => r.status).sort(), [201, 409]);
    assert.equal((await request('/api/public/surveys/neon-created')).status, 200);
    const created = creates.find(r => r.status === 201).value;
    assert.equal((await request(`/api/admin/surveys/${created.id}`, 'PUT', { ...created, status: 'closed' }, auth)).status, 200);
    assert.equal((await request('/api/public/surveys/neon-created')).status, 410);
    const payload = { version, answers: { S01: { value: 1 } }, submissionKey: crypto.randomUUID() };
    const submissions = await Promise.all(Array.from({ length: 4 }, () => request('/api/public/surveys/genai/responses', 'POST', payload)));
    assert.deepEqual(submissions.map(r => r.status).sort(), [200, 200, 200, 201]);
    assert.equal(new Set(submissions.map(r => r.value.receipt)).size, 1);
    assert.equal((await request('/api/admin/surveys/genai/responses', 'GET', undefined, auth)).value.total, 1);
    assert.equal((await request('/api/admin/surveys/genai/export', 'GET', undefined, auth)).status, 200);
    const newPassword = 'new-online-password-2026';
    assert.equal((await request('/api/auth/password', 'POST', { current: initialPassword, password: newPassword }, auth)).status, 200);
    assert.equal((await request('/api/auth/me', 'GET', undefined, other)).status, 401);
    assert.equal((await request('/api/auth/me', 'GET', undefined, auth)).status, 200);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'admin', password: initialPassword })).status, 401);
    await f.restart();
    handlers[0] = createVercelHandler({ env, openDatabase }); handlers[1] = createVercelHandler({ env, openDatabase });
    const again = await login(newPassword);
    assert.equal((await request('/api/admin/surveys/genai/responses', 'GET', undefined, again)).value.total, 1);
    assert.equal((await request('/api/admin/surveys/genai', 'GET', undefined, again)).value.version, version);
    assert.equal((await request('/api/admin/surveys', 'GET', undefined, again)).value.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); await f.cleanup(); }
});

test('deployment build emits public assets only and selects the Node function', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert.equal(spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root }).status, 0);
  assert.deepEqual(readdirSync(join(root, 'dist')).sort(), ['app.mjs', 'editor.mjs', 'favicon.svg', 'logic.mjs', 'styles.css']);
  const config = JSON.parse(readFileSync(join(root, 'vercel.json')));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.routes.at(-1).dest, '/api/index');
  assert(!readFileSync(join(root, 'package.json'), 'utf8').includes('next build'));
});
