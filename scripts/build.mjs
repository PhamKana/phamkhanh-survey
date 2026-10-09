import { mkdirSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const assets = ['app.mjs', 'editor.mjs', 'logic.mjs', 'styles.css', 'favicon.svg'];
const scripts = ['server.mjs', 'api/index.js', ...readdirSync(join(root, 'lib')).filter(name => name.endsWith('.mjs')).map(name => `lib/${name}`), ...assets.filter(name => name.endsWith('.mjs')).map(name => `public/${name}`)];
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--check', join(root, script)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
mkdirSync(output, { recursive: true });
for (const name of readdirSync(output)) if (!assets.includes(name)) throw new Error(`dist chứa file ngoài danh sách công khai: ${name}. Xóa file đó trước khi build.`);
// Explicit allowlist: source, environment variables and survey data are never static output.
for (const asset of assets) copyFileSync(join(root, 'public', asset), join(output, asset));
console.log('Vercel build complete: public assets in dist, Node handler at api/index.js.');
