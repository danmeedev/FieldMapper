const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const log = fs.createWriteStream(path.join(dir, 'pc-browser.log'), { flags:'a' });
  const write = (kind,text) => log.write(`${new Date().toISOString()} [${kind}] ${String(text).replace(/sk-ant-[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,4000)}\n`);
  const browser = await chromium.launchPersistentContext(path.join(dir,'browser-profile'), { executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:false, viewport:null, args:['--start-maximized'] });
  const observe = page => {
    page.on('console',msg=>write(msg.type(),msg.text()));
    page.on('pageerror',e=>write('pageerror',e.message));
    page.on('requestfailed',r=>write('requestfailed',`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
    page.on('response',r=>{if(r.status()>=400)write('http',`${r.status()} ${new URL(r.url()).pathname}`)});
  };
  browser.on('page',observe);for(const p of browser.pages())observe(p);
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('http://localhost:3000');write('session','PC review browser opened');
  browser.on('close',()=>log.end());
})().catch(e=>{console.error(e.message);process.exitCode=1});
