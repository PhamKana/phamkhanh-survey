import { createApp } from '../server.mjs';
import { openCloudDatabase } from './cloud-database.mjs';

export function deploymentHosts(env = process.env) {
  const hosts = new Set();
  for (const name of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL']) {
    const value = env[name];
    if (value && /^[a-zA-Z0-9.-]+$/.test(value)) hosts.add(value.toLowerCase());
  }
  if (env.APP_ORIGIN) {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN phải là địa chỉ HTTPS của website, không kèm đường dẫn.');
    hosts.add(origin.host);
  }
  if (!hosts.size) throw new Error('Cần APP_ORIGIN hoặc Vercel System Environment Variables để xác định địa chỉ website.');
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
      console.error('Survey initialization failed:', error.code || error.name);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Website chưa kết nối được database. Quản trị viên cần kiểm tra cấu hình Turso và tài khoản khởi tạo trên Vercel.' }));
    }
  };
}
