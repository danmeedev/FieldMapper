// Real GitHub metadata, real browser CORS, actual shipped checker; no provider or release mocks.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const express=require('express');
const {chromium}=require('playwright');
(async()=>{
 const app=express();let platform='windows',oldVersion=false;
 const version=require('../package.json').version;
 app.get('/update-config.json',(req,res)=>{const c=JSON.parse(fs.readFileSync(platform==='android'?'mobile-app/src/update-config.json':'public/update-config.json'));if(oldVersion)c.currentVersion='1.1.0';res.json(c);});
 app.get('/js/app-updates.js',(req,res)=>res.type('js').send(fs.readFileSync(platform==='android'?'mobile-app/src/js/app-updates.js':'public/js/app-updates.js','utf8')));
 app.get('/',(req,res)=>res.type('html').send('<!doctype html><body><script src="/js/app-updates.js"></script></body>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let browser;const evidence=[];
 try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for(platform of ['windows','android'])for(oldVersion of [false,true]){
   const context=await browser.newContext();
   await context.addInitScript(native=>{localStorage.setItem('fieldmapper-updates-v1',JSON.stringify({enabled:false,lastCheck:0}));if(native)window.Capacitor={isNativePlatform:()=>true};},platform==='android');
   const page=await context.newPage();const requests=[];page.on('request',r=>requests.push(r.url()));
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.AppUpdates);
   assert.equal(requests.some(url=>url.startsWith('https://api.github.com/')),false,'Disabled automatic checking must make no GitHub requests');
   await page.evaluate(async()=>{AppUpdates.open();await AppUpdates.check(true);});
   const status=await page.locator('#updates-status').textContent();
   if(oldVersion){assert(status.includes('Version '+version+' is available'));
    page.once('dialog',async dialog=>{assert(dialog.message().includes(version));await dialog.dismiss();});
    await page.locator('#updates-download').click();
   }else assert.match(status,/You are up to date/);
   assert.equal(requests.filter(url=>url.includes('/releases/download/')).length,0,'Detection and declining consent must not download packages');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fieldmapper-updates-v1')).enabled),false);
   assert(requests.some(url=>url.includes('api.github.com/repos/danmeedev/FieldMapper/contents/update-manifest.json?ref=main')));
   evidence.push({platform,installed:oldVersion?'1.1.0 (simulated older installation)':version,status,liveGitHubRequest:true,packageDownloaded:false,automaticCheckDisabled:true});
   console.log('PASS live GitHub check, browser CORS, and no-download consent:',platform,oldVersion?'older version offer':'current version');
   await context.close();
  }
  const config=require('../public/update-config.json');
  const remote=await fetch(`https://api.github.com/repos/${config.repository}/contents/update-manifest.json?ref=${encodeURIComponent(config.branch)}`,{headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(15000)});
  assert(remote.ok);const manifest=await remote.json();assert.equal(manifest.version,version);
  for(const kind of ['windows','android']){const asset=require('../public/js/app-updates').release({...config,currentVersion:'1.1.0'},manifest,kind);assert(asset);const response=await fetch(asset.url,{method:'HEAD',signal:AbortSignal.timeout(15000)});assert(response.ok,kind+' release asset must exist');}
  fs.mkdirSync('.review-logs',{recursive:true});fs.writeFileSync('.review-logs/live-update-verification.json',JSON.stringify(evidence,null,2));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
