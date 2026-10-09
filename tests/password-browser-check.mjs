import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const runtime=process.env.PLAYWRIGHT_PACKAGE||'C:/Users/phamk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const {chromium}=createRequire(runtime)('playwright');
const dir=mkdtempSync(join(root,'tmp-password-')),qa=join(root,'qa');mkdirSync(qa,{recursive:true});
const initial='initial-test-password-2026',updated='updated-test-password-2026';
const app=createApp({dataDir:dir,initialPassword:initial});
await new Promise(resolve=>app.server.listen(3012,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function login(password){
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill('admin');
  await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
}
async function passwordForm(current,password,confirm){
  await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill(current);
  await page.getByLabel('Mật khẩu mới',{exact:true}).fill(password);
  await page.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill(confirm);
  await page.getByRole('button',{name:'Cập nhật mật khẩu',exact:true}).click();
}
try{
  await page.goto('http://localhost:3012/admin');await login(initial);
  await page.getByRole('link',{name:'Đổi mật khẩu',exact:true}).click();
  await page.getByRole('heading',{name:'Đổi mật khẩu',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'),'account');
  await passwordForm(initial,updated,'does-not-match-2026');
  await page.locator('#password-error').getByText('Hai mật khẩu mới chưa khớp.',{exact:true}).waitFor();
  await passwordForm('incorrect-password',updated,updated);
  await page.locator('#password-error').getByText('Mật khẩu hiện tại chưa đúng.',{exact:true}).waitFor();
  await page.getByLabel('Hiện mật khẩu',{exact:true}).check();
  assert.equal(await page.locator('input[name="password"]').getAttribute('type'),'text');
  await passwordForm(initial,updated,updated);
  await page.locator('#password-success').getByText('Đã đổi mật khẩu thành công. Lần đăng nhập tiếp theo, hãy dùng mật khẩu mới.',{exact:true}).waitFor();
  assert.equal(await page.locator('#password-error').textContent(),'');
  assert.equal(await page.locator('input[name="password"]').inputValue(),'');
  assert.equal(await page.locator('input[name="password"]').getAttribute('type'),'password');
  await page.screenshot({path:join(qa,'password-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(qa,'password-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await login(initial);
  await page.getByText('Tên đăng nhập hoặc mật khẩu chưa đúng.',{exact:true}).waitFor();
  await login(updated);
  await page.getByRole('heading',{name:'Đổi mật khẩu',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Password UI checks passed: direct link, mismatch, incorrect current password, visibility toggle, update, mobile layout, old password rejected and new password accepted.');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(dir,{recursive:true,force:true});
}
