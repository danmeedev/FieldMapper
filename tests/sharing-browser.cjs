// Isolated, synthetic records only. No remote requests are allowed during sharing.
const {chromium}=require('playwright');
const express=require('express'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createStore}=require('../server/sharing-store');
const S=require('../public/js/share-format');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fieldmapper-share-browser-'));let browser,pcServer,mobileServer;
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 try{
  fs.mkdirSync(path.join(root,'photos'));fs.writeFileSync(path.join(root,'photos','sample.png'),Buffer.from(png,'base64'));
  fs.writeFileSync(path.join(root,'waypoints.json'),JSON.stringify([{id:7,name:'Selected source point',lat:0,lon:0,notes:'Share safely',photos:['sample.png'],newField:{future:true}},{id:8,name:'Private unselected point',lat:1,lon:1}]));
  const pc=express();pc.use(express.json({limit:'50mb'}));pc.use(express.static('public'));require('../server/routes-sharing')(pc,root);
  pcServer=pc.listen(0,'127.0.0.1');await new Promise(r=>pcServer.once('listening',r));
  mobileServer=express().use(express.static('mobile-app/src')).listen(0,'127.0.0.1');await new Promise(r=>mobileServer.once('listening',r));
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({geolocation:{latitude:0,longitude:0},permissions:['geolocation']});
  await context.route('**/*',r=>{
   const u=r.request().url();if(u.includes('/tiles/'))return r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});
   if(!u.startsWith('http://127.0.0.1:'))return r.abort();return r.continue();
  });
  const pcPage=await context.newPage();await pcPage.goto(`http://127.0.0.1:${pcServer.address().port}`);await pcPage.click('#open-sharing');
  await pcPage.waitForSelector('#sharing-export-list label');
  await pcPage.getByLabel('Points — Selected source point',{exact:true}).check();
  await pcPage.getByRole('button',{name:'Create sharing file',exact:true}).click();await pcPage.waitForSelector('#sharing-save:not([hidden])');
  const downloadPromise=pcPage.waitForEvent('download');await pcPage.click('#sharing-save');const downloaded=await downloadPromise;
  const saved=path.join(root,'outgoing.fieldmapper.json');await downloaded.saveAs(saved);
  const file=JSON.parse(fs.readFileSync(saved,'utf8'));assert.equal(file.records.length,1);assert.equal(file.attachments.length,1);assert(!JSON.stringify(file).includes('Private unselected point'));
  console.log('PASS PC selection, embedded photo, and downloaded sharing file');
  const phone=await context.newPage();await phone.setViewportSize({width:412,height:915});await phone.goto(`http://127.0.0.1:${mobileServer.address().port}`);await phone.waitForFunction(()=>typeof wpDB!=='undefined'&&wpDB);
  await phone.evaluate(async()=>{await saveWaypoint({id:7,name:'Receiver original',lat:2,lon:2});switchTab('map');});
  await phone.click('#map-menu-btn');await phone.click('#open-sharing');await phone.waitForSelector('#sharing-export-list label');
  await phone.locator('#sharing-file').setInputFiles(saved);await phone.waitForFunction(()=>document.querySelector('#sharing-preview-summary').textContent.includes('1 new'));
  assert.equal(await phone.evaluate(async()=>(await getAllWaypoints()).length),1,'Preview must not write data');
  phone.once('dialog',d=>d.dismiss());await phone.click('#sharing-apply');assert.equal(await phone.evaluate(async()=>(await getAllWaypoints()).length),1);
  phone.once('dialog',d=>d.accept());await phone.click('#sharing-apply');await phone.waitForFunction(()=>document.querySelector('#sharing-status').textContent.startsWith('Imported 1'));
  const imported=await phone.evaluate(async()=>{const row=(await getAllWaypoints()).find(r=>r.name==='Selected source point');return {row,photos:await getPhotos(row.id)};});
  assert.notEqual(imported.row.id,7);assert.equal(imported.row.newField.future,true);assert.equal(imported.photos.length,1);
  console.log('PASS Android file picker, preview, declined consent, and atomic import preserving original');
  await phone.locator('#sharing-file').setInputFiles(saved);await phone.waitForFunction(()=>document.querySelector('#sharing-preview-summary').textContent.includes('1 skipped'));assert.equal(await phone.locator('#sharing-apply').isDisabled(),true);
  console.log('PASS repeat import skips duplicates');
  await phone.getByLabel('Points — Selected source point',{exact:true}).check();await phone.getByRole('button',{name:'Create sharing file',exact:true}).click();await phone.waitForSelector('#sharing-save:not([hidden])');
  const returnPromise=phone.waitForEvent('download');await phone.click('#sharing-save');const returning=await returnPromise;const returnFile=path.join(root,'return.fieldmapper.json');await returning.saveAs(returnFile);
  const roundtrip=JSON.parse(fs.readFileSync(returnFile,'utf8'));assert.deepEqual(roundtrip.records[0].origin,file.records[0].origin);assert.equal(roundtrip.attachments[0].id,file.attachments[0].id);
  const checked=await createStore(root).preview(roundtrip);assert.equal(checked.plan.counts.skip,1);
  console.log('PASS Android re-export preserves original identity and photo bytes');
  const bad={...file,version:{major:99,minor:0}};await phone.locator('#sharing-file').setInputFiles({name:'newer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await phone.waitForFunction(()=>document.querySelector('#sharing-status').textContent.includes('Unsupported sharing protocol'));assert.equal(await phone.evaluate(async()=>(await getAllWaypoints()).length),2);
  await pcPage.screenshot({path:'.review-logs/sharing-pc.png'});await phone.screenshot({path:'.review-logs/sharing-mobile.png'});
  const response=await fetch(`http://127.0.0.1:${pcServer.address().port}/api/sharing/catalog`,{headers:{Origin:'https://untrusted.invalid'}});assert.equal(response.status,403);
  console.log('PASS incompatible protocol cannot write data; untrusted origins cannot read sharing API');
 }finally{await browser?.close();if(pcServer)await new Promise(r=>pcServer.close(r));if(mobileServer)await new Promise(r=>mobileServer.close(r));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('fieldmapper-share-browser-'))fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
