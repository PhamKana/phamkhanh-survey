import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase, verifyPassword, hashPassword, tokenHash } from './lib/database.mjs';
import { validateSurvey, validateSubmission } from './lib/validation.mjs';
import { displayAnswer } from './public/logic.mjs';
import { seedSurvey } from './lib/seed.mjs';
import { writeBatch } from './lib/schema.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const SESSION_MS = 8 * 60 * 60 * 1000;
const DUMMY_HASH = hashPassword(randomBytes(24).toString('hex'));
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
export function createApp({ dataDir = join(root, 'data'), initialPassword, allowedHosts = [], secureCookies = false, database, hosted = false } = {}) {
  const db = database || openDatabase(dataDir, initialPassword);
  const buckets = new Map();
  const rateLimit = async (key, limit, window) => {
    if (db.consumeRateLimit) {
      if (!await db.consumeRateLimit(key, limit, window)) throw httpError(429, 'Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.');
      return;
    }
    const now = Date.now();
    for (const [k, entry] of buckets) if (entry.until < now) buckets.delete(k);
    const entry = buckets.get(key) || { count: 0, until: now + window };
    if (++entry.count > limit) throw httpError(429, 'Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.');
    buckets.set(key, entry);
  };
  async function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('survey_session='))?.slice(15);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = await db.prepare('SELECT s.*, a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires>?').get(tokenHash(token), Date.now());
    return row || null;
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw httpError(415, 'Vui lòng gửi dữ liệu JSON.');
    let size = 0, parts = [];
    // Vercel's Node helpers may have parsed the stream before calling the handler.
    if (req.body !== undefined) {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      size = raw.length; parts = [raw];
    } else {
      for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) throw httpError(413, 'Dữ liệu quá lớn (tối đa 512 KB).'); parts.push(chunk); }
    }
    if (size > 512 * 1024) throw httpError(413, 'Dữ liệu quá lớn (tối đa 512 KB).');
    try {
      const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid object');
      return parsed;
    } catch { throw httpError(400, 'JSON không hợp lệ.'); }
  }
  async function surveyRow(id) {
    const row = await db.prepare('SELECT * FROM surveys WHERE id=?').get(id);
    if (!row) throw httpError(404, 'Không tìm thấy khảo sát.');
    return { ...JSON.parse(row.config), id: row.id, version: row.version, createdAt: row.created_at };
  }
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const host = req.headers.host || '';
      const port = server.address()?.port;
      if (!(hosted ? allowedHosts : [ `localhost:${port}`, `127.0.0.1:${port}`, ...allowedHosts ]).includes(host)) throw httpError(403, 'Địa chỉ truy cập không được cho phép.');
      const url = new URL(req.url, `http://${host}`), path = url.pathname;
      const mutation = !['GET','HEAD'].includes(req.method);
      if (mutation) {
        const origin = req.headers.origin;
        if (origin !== `${secureCookies ? 'https' : 'http'}://${host}` || req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Nguồn yêu cầu không hợp lệ.');
      }
      if (req.method === 'GET' && path === '/api/health') return json(200, { ok: true });
      if (path === '/api/auth/login' && req.method === 'POST') {
        await rateLimit(`login:${(hosted ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress : req.socket?.remoteAddress)}`, 10, 15 * 60 * 1000);
        const input = await body(req);
        if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 256) throw httpError(400, 'Tài khoản hoặc mật khẩu không hợp lệ.');
        const admin = await db.prepare('SELECT * FROM admins WHERE username=?').get(input.username);
        const valid = verifyPassword(input.password, admin?.password_hash || DUMMY_HASH);
        if (!admin || !valid) throw httpError(401, 'Tên đăng nhập hoặc mật khẩu chưa đúng.');
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
        await db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
        const inserted = await db.prepare('INSERT INTO sessions SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM admins WHERE id=? AND password_hash=?)').run(tokenHash(token), admin.id, csrf, Date.now() + SESSION_MS, admin.id, admin.password_hash);
        if (!inserted.changes) throw httpError(401, 'Mật khẩu vừa được thay đổi. Vui lòng đăng nhập lại.');
        res.setHeader('Set-Cookie', `survey_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureCookies ? '; Secure' : ''}`);
        return json(200, { username: admin.username, csrf });
      }
      if (path === '/api/auth/me' && req.method === 'GET') {
        const auth = await session(req);
        if (!auth) throw httpError(401, 'Vui lòng đăng nhập.');
        return json(200, { username: auth.username, csrf: auth.csrf });
      }
      if (path.startsWith('/api/admin/') || path === '/api/auth/logout' || path === '/api/auth/password') {
        const auth = await session(req);
        if (!auth) throw httpError(401, 'Vui lòng đăng nhập để xem dữ liệu khảo sát.');
        if (mutation && req.headers['x-csrf-token'] !== auth.csrf) throw httpError(403, 'Phiên yêu cầu không hợp lệ. Hãy tải lại trang.');
        if(path==='/api/admin/templates/genai'&&req.method==='GET')return json(200,seedSurvey);
        if (path === '/api/auth/logout' && req.method === 'POST') {
          await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.token_hash);
          res.setHeader('Set-Cookie', 'survey_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(200, { ok: true });
        }
        if (path === '/api/auth/password' && req.method === 'POST') {
          await rateLimit(`password:${auth.admin_id}`, 5, 15 * 60 * 1000);
          const input = await body(req), admin = await db.prepare('SELECT * FROM admins WHERE id=?').get(auth.admin_id);
          if (typeof input.current !== 'string' || input.current.length > 256 || !verifyPassword(input.current, admin.password_hash)) throw httpError(400, 'Mật khẩu hiện tại chưa đúng.');
          if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) throw httpError(400, 'Mật khẩu mới cần từ 12 đến 256 ký tự.');
          const nextHash = hashPassword(input.password);
          const results = await writeBatch(db, [
            { sql: 'UPDATE admins SET password_hash=? WHERE id=? AND password_hash=?', args: [nextHash, auth.admin_id, admin.password_hash] },
            { sql: 'DELETE FROM sessions WHERE admin_id=? AND token_hash<>? AND EXISTS (SELECT 1 FROM admins WHERE id=? AND password_hash=?)', args: [auth.admin_id, auth.token_hash, auth.admin_id, nextHash] },
          ]);
          if (!results[0].changes) throw httpError(409, 'Mật khẩu vừa được thay đổi ở phiên khác. Vui lòng đăng nhập lại.');
          if (!hosted) { const credentials = join(dataDir, 'admin-first-login.txt'); if (existsSync(credentials)) unlinkSync(credentials); }
          return json(200, { ok: true });
        }
        if (path === '/api/admin/surveys' && req.method === 'GET') {
          const rows = await db.prepare('SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id=s.id) AS total, (SELECT COUNT(*) FROM responses r WHERE r.survey_id=s.id AND outcome=\'eligible\') AS eligible FROM surveys s ORDER BY created_at DESC').all();
          return json(200, rows.map(r => ({ ...JSON.parse(r.config), id: r.id, version: r.version, createdAt: r.created_at, total: r.total, eligible: r.eligible })));
        }
        if (path === '/api/admin/surveys' && req.method === 'POST') {
          const input = validateSurvey(await body(req));
          if (await db.prepare('SELECT id FROM surveys WHERE slug=?').get(input.slug)) throw httpError(409, 'Đường dẫn này đã được sử dụng.');
          const id = randomUUID();
          await db.prepare('INSERT INTO surveys(id,slug,config,created_at) VALUES (?,?,?,?)').run(id, input.slug, JSON.stringify(input), new Date().toISOString());
          return json(201, await surveyRow(id));
        }
        const match = path.match(/^\/api\/admin\/surveys\/([a-z0-9-]+)(?:\/(responses|export|schema))?$/);
        if (match) {
          const survey = await surveyRow(match[1]), action = match[2];
          if (!action && req.method === 'GET') return json(200, survey);
          if (!action && req.method === 'PUT') {
            const input = await body(req);
            if (input.version !== survey.version) throw httpError(409, 'Khảo sát đã thay đổi. Hãy tải lại bản mới trước khi lưu.');
            const clean = validateSurvey(input, survey);
            if (await db.prepare('SELECT id FROM surveys WHERE slug=? AND id<>?').get(clean.slug, survey.id)) throw httpError(409, 'Đường dẫn này đã được sử dụng.');
            const result = await db.prepare('UPDATE surveys SET config=?,slug=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(clean), clean.slug, survey.id, survey.version);
            if (!result.changes) throw httpError(409, 'Khảo sát đã thay đổi. Hãy tải lại bản mới trước khi lưu.');
            return json(200, await surveyRow(survey.id));
          }
          if (action === 'schema' && req.method === 'GET') {
            res.setHeader('Content-Disposition', `attachment; filename="${survey.slug}-template.json"`);
            return json(200, survey);
          }
          if (action === 'responses' && req.method === 'GET') {
            const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
            const filter = ['eligible','screened_out'].includes(url.searchParams.get('outcome')) ? url.searchParams.get('outcome') : null;
            const where = filter ? 'survey_id=? AND outcome=?' : 'survey_id=?';
            const params = filter ? [survey.id, filter] : [survey.id];
            const total = (await db.prepare(`SELECT COUNT(*) AS n FROM responses WHERE ${where}`).get(...params)).n;
            const rows = await db.prepare(`SELECT * FROM responses WHERE ${where} ORDER BY created_at DESC, id LIMIT 25 OFFSET ?`).all(...params, Math.min((page - 1) * 25, Number.MAX_SAFE_INTEGER));
            return json(200, { total, page, pages: Math.max(1, Math.ceil(total / 25)), responses: rows.map(r => ({ id: r.id, createdAt: r.created_at, version: r.version, outcome: r.outcome, answers: JSON.parse(r.answers), meta: JSON.parse(r.meta), snapshot: JSON.parse(r.snapshot) })) });
          }
          if (action === 'export' && req.method === 'GET') {
            const columns = ['response_id','submitted_at','outcome','survey_version','saved_hours','time_conflict','time_basis','missing_saving_magnitude','job_other_review'];
            // Export historical fields too, using each response's immutable question snapshot.
            const rows = await db.prepare('SELECT * FROM responses WHERE survey_id=? ORDER BY created_at').all(survey.id);
            const questions = new Map(survey.questions.map(q => [q.id,q]));
            for (const r of rows) for (const q of JSON.parse(r.snapshot).questions) questions.set(q.id,q);
            for (const q of questions.values()) { columns.push(q.id, `${q.id}_label`, `${q.id}_other`); if (q.type === 'allocation') q.options.forEach((_,i) => columns.push(`${q.id}_${i+1}_percent`)); }
            const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s) && typeof value !== 'number') s = "'" + s; return '"' + s.replaceAll('"','""') + '"'; };
            const csv = ['\uFEFF' + columns.map(cell).join(',')];
            for (const r of rows) {
              const answers = JSON.parse(r.answers), meta = JSON.parse(r.meta), snapshot = JSON.parse(r.snapshot);
              const values = { response_id: r.id, submitted_at: r.created_at, outcome: r.outcome, survey_version: r.version, saved_hours: meta.savedHours, time_conflict: meta.timeConflict, time_basis: meta.timeBasis, missing_saving_magnitude: meta.missingSavingMagnitude, job_other_review: meta.jobOtherReview };
              for (const q of snapshot.questions) if (answers[q.id]) {
                const a = answers[q.id]; values[q.id] = a.special !== undefined ? `special:${a.special}` : Array.isArray(a.value) ? JSON.stringify(a.value) : a.value;
                values[`${q.id}_label`] = displayAnswer(q, a); values[`${q.id}_other`] = a.other;
                if (q.type === 'allocation' && a.value) a.value.forEach((v,i) => { values[`${q.id}_${i+1}_percent`] = v; });
              }
              csv.push(columns.map(key => cell(values[key])).join(','));
            }
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${survey.slug}-responses.csv"` });
            return res.end(csv.join('\r\n'));
          }
        }
      }
      const publicMatch = path.match(/^\/api\/public\/surveys\/([a-z0-9-]+)(?:\/(responses))?$/);
      if (publicMatch) {
        const row = await db.prepare('SELECT * FROM surveys WHERE slug=?').get(publicMatch[1]);
        if (!row) throw httpError(404, 'Không tìm thấy khảo sát.');
        const survey = { ...JSON.parse(row.config), version: row.version };
        if (survey.status !== 'open') throw httpError(410, 'Khảo sát hiện không nhận câu trả lời.');
        if (!publicMatch[2] && req.method === 'GET') return json(200, survey);
        if (publicMatch[2] && req.method === 'POST') {
          await rateLimit(`submit:${(hosted ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress : req.socket?.remoteAddress)}`, 60, 60 * 60 * 1000);
          const input = await body(req);
          const existing = typeof input?.submissionKey === 'string' && await db.prepare('SELECT id FROM responses WHERE survey_id=? AND submission_key=?').get(row.id, input.submissionKey);
          if (existing) return json(200, { ok: true, receipt: existing.id });
          if (input.version !== row.version) throw httpError(409, 'Khảo sát vừa được cập nhật. Câu trả lời hiện tại vẫn được giữ trên trang; vui lòng trao đổi với quản trị viên trước khi tải lại.');
          const { answers, meta, outcome } = validateSubmission(survey, input);
          const id = randomUUID();
          const result = await db.prepare(`INSERT INTO responses SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM surveys WHERE id=? AND version=? AND json_extract(config,'$.status')='open') ON CONFLICT(survey_id,submission_key) DO NOTHING`).run(id, row.id, input.submissionKey, row.version, JSON.stringify(answers), JSON.stringify(meta), JSON.stringify(survey), outcome, new Date().toISOString(), row.id, row.version);
          if (!result.changes) {
            const receipt = await db.prepare('SELECT id FROM responses WHERE survey_id=? AND submission_key=?').get(row.id, input.submissionKey);
            if (receipt) return json(200, { ok: true, receipt: receipt.id });
            throw httpError(409, 'Khảo sát vừa được cập nhật hoặc đóng. Vui lòng liên hệ quản trị viên.');
          }
          return json(201, { ok: true, receipt: id });
        }
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === '/') { res.writeHead(302, { Location: '/s/genai' }); return res.end(); }
        const assets = { '/app.mjs': ['app.mjs','text/javascript'], '/editor.mjs': ['editor.mjs','text/javascript'], '/logic.mjs': ['logic.mjs','text/javascript'], '/styles.css': ['styles.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
        const asset = assets[path];
        if (asset) { res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : readFileSync(join(root,'public',asset[0]))); }
        if (path === '/admin' || /^\/s\/[a-z0-9-]+$/.test(path)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : readFileSync(join(root,'public','index.html'))); }
      }
      throw httpError(404, 'Không tìm thấy trang.');
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT') && /surveys\.slug/.test(error.message)) error = httpError(409, 'Đường dẫn này đã được sử dụng.');
      if (!error.status) console.error('Request error:', error.code || error.name);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
      else res.end();
    }
  };
  const server = createServer(handler);
  return { server, db, handler };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.VERCEL) throw new Error('Vercel phải gọi api/index.js; không chạy máy chủ local hoặc tạo SQLite tại đây.');
  const port = Number(process.env.PORT || 3000);
  const database = process.env.TURSO_DATABASE_URL ? await (await import('./lib/cloud-database.mjs')).openCloudDatabase() : undefined;
  const app = createApp({ database, hosted: Boolean(database), allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, ...(process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean)], secureCookies: process.env.SECURE_COOKIES === 'true' });
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Survey Studio: http://localhost:${port}/s/genai`);
    console.log(`Admin: http://localhost:${port}/admin`);
    console.log(database ? 'Database online; tài khoản lần đầu dùng ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD trong .env.' : 'Tài khoản lần đầu: data/admin-first-login.txt');
  });
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Cổng ${port} đang được sử dụng. Hãy đổi PORT hoặc đóng ứng dụng đang dùng cổng này.` : error.message); process.exit(1); });
  const stop = () => { app.server.close(() => { app.db.close(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
