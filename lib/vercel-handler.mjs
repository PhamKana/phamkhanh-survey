import { createApp } from '../server.mjs';
import { openCloudDatabase } from './cloud-database.mjs';
import { SetupError, setupDiagnostic } from './setup-errors.mjs';

export function deploymentHosts(env = process.env) {
  const hosts = new Set();
  for (const name of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL']) {
    const value = env[name];
    if (value && /^[a-zA-Z0-9.-]+$/.test(value)) hosts.add(value.toLowerCase());
  }
  if (env.APP_ORIGIN) {
    let origin;
    try { origin = new URL(env.APP_ORIGIN); } catch { throw new SetupError('APP_ORIGIN_INVALID', 'APP_ORIGIN phải là địa chỉ HTTPS của website, không kèm đường dẫn.'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new SetupError('APP_ORIGIN_INVALID', 'APP_ORIGIN phải là địa chỉ HTTPS của website, không kèm đường dẫn.');
    hosts.add(origin.host);
  }
  if (!hosts.size) throw new SetupError('APP_ORIGIN_MISSING', 'Bật System Environment Variables của Vercel hoặc đặt APP_ORIGIN bằng địa chỉ HTTPS của website rồi Redeploy.');
  return [...hosts];
}

export function createVercelHandler({ env = process.env, openDatabase = openCloudDatabase } = {}) {
  let appPromise;
  let pages;
  return async (req, res) => {
    try {
      const options = { allowedHosts: deploymentHosts(env), secureCookies: true, hosted: true };
      // Public assets and HTML need no database connection or credentials.
      if (!req.url.split('?')[0].startsWith('/api/')) {
        pages ||= createApp({ ...options, database: {} });
        return await pages.handler(req, res);
      }
      if (!appPromise) {
        appPromise = openDatabase(env).then(database => createApp({ ...options, database }));
        appPromise.catch(() => { appPromise = undefined; });
      }
      const app = await appPromise;
      return await app.handler(req, res);
    } catch (error) {
      // Log only the category: database errors can embed credential-bearing URLs.
      const diagnostic = setupDiagnostic(error);
      console.error('Survey initialization failed:', diagnostic.code);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      const path = req.url.split('?')[0];
      const detailed = path === '/api/health' || path.startsWith('/api/auth/') || path.startsWith('/api/admin/');
      res.end(JSON.stringify({ ...(path === '/api/health' ? { ok: false } : {}), code: diagnostic.code, error: detailed ? diagnostic.message : 'Khảo sát chưa sẵn sàng. Vui lòng liên hệ người gửi link khảo sát hoặc quay lại sau.' }));
    }
  };
}
