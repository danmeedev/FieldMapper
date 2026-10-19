const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const express = require('express');
const assert = require('node:assert/strict');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function port() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p; }
(async()=>{
  fs.mkdirSync('.review-logs',{recursive:true});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fieldmapper-browser-'));const hp=await port(),sp=await port();
  const log=fs.openSync('.review-logs/browser-test-server.log','w');
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,FIELDMAPPER_PORT:String(hp),FIELDMAPPER_HTTPS_PORT:String(sp),FIELDMAPPER_DATA_DIR:dir,FIELDMAPPER_CONFIG_FILE:path.join(dir,'config.json'),FIELDMAPPER_TILES_DIR:path.join(dir,'tiles')},stdio:['ignore',log,log]});
  let browser,mobileServer;
  try {
    const base=`http://127.0.0.1:${hp}`;
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}await pause(100);}
    for (const [scheme,portNumber] of [['ws',hp],['wss',sp]]) {
      const { WebSocket } = require('ws');
      const viewer=new WebSocket(`${scheme}://127.0.0.1:${portNumber}`,{rejectUnauthorized:false});
      await new Promise((resolve,reject)=>{viewer.once('open',resolve);viewer.once('error',reject)});
      const sender=new WebSocket(`${scheme}://127.0.0.1:${portNumber}/?role=gps`,{rejectUnauthorized:false});
      await new Promise((resolve,reject)=>{sender.once('open',resolve);sender.once('error',reject)});
      const received=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('GPS relay timed out')),5000);
        viewer.on('message',raw=>{const m=JSON.parse(raw);if(m.reviewCheck===scheme){clearTimeout(timeout);resolve(m)}});
      });
      sender.send(JSON.stringify({type:'gps',lat:39,lon:-118,reviewCheck:scheme}));
      assert.equal((await received).reviewCheck,scheme);sender.close();viewer.close();
    }
    console.log('PASS HTTP/HTTPS WebSocket GPS relay');
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const context=await browser.newContext({geolocation:{latitude:39,longitude:-118},permissions:['geolocation']});
    const errors=[];
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith('https://api.github.com/repos/danmeedev/FieldMapper/contents/update-manifest.json'))return route.fulfill({json:require('../update-manifest.json')});
      if(url.includes('/tiles/'))return route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});
      if(!url.startsWith('http://127.0.0.1:'))return route.abort();
      return route.continue();
    });
    await page.goto(base);await page.waitForFunction(()=>!!window.AiSettings);
    await page.evaluate(()=>AiSettings.refresh());assert.equal(await page.locator('#toggle-ai').isVisible(),false);
    await page.click('#toggle-settings');await page.click('#open-ai-config');await page.waitForSelector('#ai-config-dialog[open]');
    assert.match(await page.locator('#ai-config-message').textContent(),/disabled/);await page.click('#ai-config-close');
    console.log('PASS desktop startup/config menu and hidden AI');
    mobileServer=express().use(express.static('mobile-app/src')).listen(0,'127.0.0.1');await new Promise(r=>mobileServer.once('listening',r));
    const mobileBase=`http://127.0.0.1:${mobileServer.address().port}`;
    const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto(mobileBase);await mobile.waitForFunction(()=>typeof wpDB!=='undefined'&&wpDB);
    await mobile.evaluate(async(base)=>{await saveSetting('laptopUrl',base);await saveWaypoint({id:123,name:'Browser review',lat:39,lon:-118,category:'general',timestamp:new Date().toISOString()});},base);
    await mobile.evaluate(()=>showWaypointDetail(123));assert.equal(await mobile.locator('#ai-analyze-btn').isVisible(),false);
    await mobile.evaluate(()=>document.getElementById('wp-detail-overlay').remove());
    const result=await mobile.evaluate(()=>syncToLaptop());assert.equal(result.errors,0);
    const list=await(await fetch(base+'/api/waypoints')).json();assert.equal(list[0].name,'Browser review');
    console.log('PASS mobile startup and cross-origin push');
    const changed={...list[0],name:'Laptop changed',updatedAt:list[0].updatedAt+1000};
    await fetch(base+'/api/waypoint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(changed)});
    await mobile.evaluate(()=>syncToLaptop());assert.equal(await mobile.evaluate(async()=> (await getWaypoint(123)).name),'Laptop changed');
    // Delete later than the synthetic server version so reconciliation chooses the tombstone.
    await mobile.evaluate(async()=>{const w=await getWaypoint(123);await deleteWaypoint(123,{deletedAt:w.updatedAt+1000});});
    const deleted=await mobile.evaluate(()=>syncToLaptop());assert.equal(deleted.errors,0);assert.equal((await(await fetch(base+'/api/waypoints')).json()).length,0);
    console.log('PASS desktop edit pull and browser CORS DELETE propagation (B04)');
    // Mock only UI-facing provider status; never persist a successful fake test to the server config.
    let ready=false;
    await page.route('**/api/ai/status',r=>r.fulfill({json:{state:ready?'ready':'needs-test',ready,aiEnabled:true,aiModel:'claude-sonnet-4-6',anthropicApiKeySet:true}}));
    await page.route('**/api/ai/test',r=>{ready=true;return r.fulfill({json:{state:'ready',ready:true}})});
    await page.evaluate(()=>AiSettings.refresh());assert.equal(await page.locator('#toggle-ai').isVisible(),false);
    await page.evaluate(()=>AiSettings.open());await page.click('#ai-config-test');await page.waitForFunction(()=>AiSettings.ready);
    await page.click('#ai-config-close');assert.equal(await page.locator('#toggle-ai').isVisible(),true);
    ready=false;await page.evaluate(()=>AiSettings.refresh());assert.equal(await page.locator('#toggle-ai').isVisible(),false);
    console.log('PASS AI tools reveal only after successful test and hide on invalidation');
    for (const screen of [page,mobile]) {
      await screen.evaluate(()=>AppUpdates.open());
      await screen.locator('#updates-check').click();
      await screen.waitForFunction(()=>document.querySelector('#updates-status').textContent.includes('up to date'));
      await screen.locator('#updates-enabled').uncheck();
      await screen.locator('#updates-close').click();
      await screen.reload();
      await screen.waitForFunction(()=>!!window.AppUpdates);
      await screen.evaluate(()=>AppUpdates.open());
      assert.equal(await screen.locator('#updates-enabled').isChecked(),false);
      await screen.locator('#updates-close').click();
    }
    console.log('PASS PC/Android update menu, release metadata and persistent opt-out');

    await page.screenshot({path:'.review-logs/desktop-smoke.png'});await mobile.screenshot({path:'.review-logs/mobile-smoke.png'});
    assert.deepEqual(errors,[]);console.log('PASS no uncaught desktop/mobile browser errors');
  } finally {
    await browser?.close();if(mobileServer)await new Promise(r=>mobileServer.close(r));child.kill();await new Promise(r=>child.once('exit',r));fs.closeSync(log);
    if(path.dirname(dir)===os.tmpdir())fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
