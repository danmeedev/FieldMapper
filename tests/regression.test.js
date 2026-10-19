const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { IDBFactory } = require('fake-indexeddb');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldmapper-test-'));
  t.after(() => { if (path.dirname(dir) === os.tmpdir()) fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
async function fixture(t) {
  const dir = temp(t), photosDir = path.join(dir, 'photos'); fs.mkdirSync(photosDir);
  const app = express(); app.use(express.json());
  require('../server/routes-waypoints')(app, dir, { photosDir, getMapClients: () => [], getLatestGPS: () => null, setLatestGPS() {} });
  require('../server/routes-routes')(app, dir, { photosDir });
  require('../server/routes-ai')(app, dir, path.join(dir, 'config.json'), { photosDir, callProvider: async () => 'OK' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (p, body) => fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { dir, photosDir, send };
}
function mobile(fetcher) {
  class Reader { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onloadend(); }).catch(() => this.onerror()); } }
  const ctx = vm.createContext({ console, indexedDB: new IDBFactory(), fetch: fetcher, FileReader: Reader, Blob, AbortSignal, AiSettings: { requireReady: async () => {} } });
  for (const file of ['waypoint-store', 'sync-engine']) vm.runInContext(fs.readFileSync(`mobile-app/src/js/${file}.js`, 'utf8'), ctx);
  return { ctx, run: code => vm.runInContext(code, ctx) };
}

test('B01 failed or invalid list never schedules local pushes', async () => {
  for (const response of [{ ok:false, status:500 }, { ok:true, json:async()=>({error:'bad'}) }, { ok:true, json:async()=>{throw Error('bad JSON')} }]) {
    const m = mobile(async()=>response);
    m.ctx.desc = { type:'waypoints', listPath:'/list', getLocal:async()=>[{id:1,updatedAt:10}], push:async()=>assert.fail('must not write') };
    await assert.rejects(m.run('reconcileType("http://test", {}, desc, {errors:0})'));
  }
});
test('B01 failed tombstones abort the entire sync before any write', async () => {
  let writes = 0;
  const m = mobile(async(url, opts) => { if(opts?.method === 'POST') writes++; return url.endsWith('/api/status') ? {ok:true,json:async()=>({ok:true})} : {ok:false,status:503}; });
  await m.run('saveSetting("laptopUrl", "http://test")');
  await assert.rejects(m.run('syncToLaptop()')); assert.equal(writes,0);
});
test('B01 valid empty snapshots still push a new local record', async () => {
  const m=mobile(async()=>({ok:true,json:async()=>[]}));let count=0;
  m.ctx.desc={type:'waypoints',listPath:'/list',getLocal:async()=>[{id:1,updatedAt:10}],push:async()=>{count++;return true},markSynced:async()=>{}};
  await m.run('reconcileType("http://test", {}, desc, {errors:0,pushedCreated:0})');assert.equal(count,1);
});
test('B02/B06 route photo edits preserve retained bytes and normalize URLs',async t=>{
  const f=await fixture(t);const image=x=>'data:image/jpeg;base64,'+Buffer.from(x).toString('base64');
  await f.send('/api/route',{id:1,points:[{photos:[image('A'),image('B')]}]});
  let route=(await (await f.send('/api/routes')).json())[0]; const keep=route.points[0].photos[1];
  await f.send('/api/route',{id:1,points:[{photos:['http://old-host/photos/'+keep+'?v=1',image('C')]}]});
  route=(await (await f.send('/api/routes')).json())[0]; assert.equal(new Set(route.points[0].photos).size,2);
  assert.equal(route.points[0].photos[0],keep);assert.equal(fs.readFileSync(path.join(f.photosDir,keep),'utf8'),'B');
  const exported=await (await f.send('/api/export/route/1')).json(); assert.equal(exported.points[0].photoUrls[0],'/photos/'+keep);
});
test('B03 complete pull replaces 2 photos with 1 then 0',async()=>{
  const m=mobile(async()=>({ok:true,blob:async()=>new Blob(['new'],{type:'image/jpeg'})}));
  await m.run('saveWaypoint({id:1,updatedAt:1})');await m.run('savePhoto(1,0,"oldA")');await m.run('savePhoto(1,1,"oldB")');
  await m.run('SYNC_DESCRIPTORS[0].saveLocal({id:1,updatedAt:2,photos:["new.jpg"]},"http://test")');
  assert.equal((await m.run('getPhotos(1)')).length,1);assert.equal((await m.run('getWaypoint(1)')).updatedAt,2);
  await m.run('SYNC_DESCRIPTORS[0].saveLocal({id:1,updatedAt:3,photos:[]},"http://test")');
  assert.equal((await m.run('getPhotos(1)')).length,0);assert.equal((await m.run('getWaypoint(1)')).photoCount,0);
});
test('B03 failed photo download leaves old record and complete photo set intact',async()=>{
  const m=mobile(async()=>({ok:false,status:404}));await m.run('saveWaypoint({id:1,name:"old"})');await m.run('savePhoto(1,0,"oldA")');
  await assert.rejects(m.run('SYNC_DESCRIPTORS[0].saveLocal({id:1,name:"new",photos:["bad.jpg"]},"http://test")'));
  assert.equal((await m.run('getWaypoint(1)')).name,'old');assert.equal((await m.run('getPhotos(1)'))[0].dataUrl,'oldA');
});
test('B05 generic tile handler passes contours to the specialized handler',()=>{
  const routes=[]; require('../server/tile-proxy')({get:(p,h)=>routes.push([p,h]),post(){}},'unused');
  let next=false;routes.find(([p])=>p==='/tiles/:layer/:z/:x/:y.png')[1]({params:{layer:'contours'}},{send:()=>assert.fail('shadowed')},()=>{next=true});assert.equal(next,true);
});
test('B07 export accepts string and nonnumeric route ids',async t=>{
  const f=await fixture(t);for(const id of ['123','r_abc']){await f.send('/api/route',{id,points:[]});assert.equal((await f.send('/api/export/route/'+id)).status,200);}
  assert.equal((await f.send('/api/export/route/missing')).status,404);
});
test('B08 GPS accepts zero axes and rejects invalid coordinates',async t=>{
  const f=await fixture(t);for(const body of [{lat:0,lon:10},{lat:10,lon:0},{lat:0,lon:0}])assert.equal((await f.send('/api/gps',body)).status,200);
  for(const body of [{lat:null,lon:1},{lat:91,lon:1},{lat:1,lon:181},{lat:'0',lon:1},{}])assert.equal((await f.send('/api/gps',body)).status,400);
});
test('R01 endpoints hide credentials and reject analysis before a successful test',async t=>{
  const f=await fixture(t);assert.equal((await f.send('/api/ai/analyze',{})).status,409);
  const saved=await (await f.send('/api/config',{aiEnabled:true,aiModel:'claude-sonnet-4-6',anthropicApiKey:'test-secret'})).json();assert.equal(saved.ready,false);
  assert.equal(JSON.stringify(saved).includes('test-secret'),false);
  assert.equal((await f.send('/api/ai/analyze',{})).status,409);
  assert.equal((await (await f.send('/api/ai/test',{})).json()).ready,true);
  assert.equal((await (await f.send('/api/ai/status')).json()).ready,true);
  await f.send('/api/config',{aiModel:'claude-different'});assert.equal((await (await f.send('/api/ai/status')).json()).ready,false);
  assert.equal((await f.send('/api/config',{anthropicApiKey:'****secret'})).status,400);
});
test('R01 verification survives restart but changes and disabling invalidate it',async t=>{
  const file=path.join(temp(t),'config.json');const create=require('../server/ai-config');let ai=create(file,async()=> 'OK');
  ai.save({aiEnabled:true,aiModel:'claude-sonnet-4-6',anthropicApiKey:'fake'});await ai.test();assert.equal(create(file,async()=> 'OK').status().ready,true);
  ai.save({aiEnabled:false});assert.equal(ai.status().ready,false);ai.save({aiEnabled:true});assert.equal(ai.status().ready,false);
});
test('R01 changed config during a test cannot verify the new revision',async t=>{
  let resolve;const ai=require('../server/ai-config')(path.join(temp(t),'config.json'),()=>new Promise(r=>resolve=r));
  ai.save({aiEnabled:true,anthropicApiKey:'fake'});const pending=ai.test();ai.save({aiModel:'claude-new'});resolve('OK');await assert.rejects(pending);assert.equal(ai.status().ready,false);
});
test('R01 empty/failed provider responses cannot establish readiness',async t=>{
  for(const provider of [async()=>'',async()=>{throw Error('failure')}]){
    const ai=require('../server/ai-config')(path.join(temp(t),'config.json'),provider);ai.save({aiEnabled:true,anthropicApiKey:'fake'});await assert.rejects(ai.test());assert.equal(ai.status().ready,false);
  }
});
test('R01 environment keys are never copied into stored configuration or returned status',async t=>{
  const old=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='environment-secret';
  try {const file=path.join(temp(t),'config.json'),ai=require('../server/ai-config')(file,async()=> 'OK');ai.save({aiEnabled:true});await ai.test();assert.equal(fs.readFileSync(file,'utf8').includes('environment-secret'),false);assert.equal(JSON.stringify(ai.status()).includes('environment-secret'),false);process.env.ANTHROPIC_API_KEY='changed-secret';assert.equal(ai.status().ready,false);}
  finally {if(old===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=old;}
});

test('B03 explicit empty photo upload removes server references; metadata-only retains them',async t=>{
  const f=await fixture(t);const image='data:image/jpeg;base64,'+Buffer.from('A').toString('base64');
  await f.send('/api/waypoint',{id:1,photoData:[image]});let wp=(await(await f.send('/api/waypoints')).json())[0];assert.equal(wp.photos.length,1);
  await f.send('/api/waypoint',{...wp,name:'metadata'});assert.equal((await(await f.send('/api/waypoints')).json())[0].photos.length,1);
  await f.send('/api/waypoint',{...wp,photoData:[]});assert.equal((await(await f.send('/api/waypoints')).json())[0].photos.length,0);
});

test('Android schema upgrades preserve existing records, photos and settings',async()=>{
  for(const version of [4,5]) {
    const idb=new IDBFactory();
    const legacy=await new Promise((resolve,reject)=>{
      const req=idb.open('fieldmapper-data',version);
      req.onupgradeneeded=()=>{for(const store of ['waypoints','photos','routes',...(version===5?['specimens','digOrders']:[])])req.result.createObjectStore(store,{keyPath:'id'});req.result.createObjectStore('settings');};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const stores=['waypoints','photos','routes','settings',...(version===5?['specimens','digOrders']:[])];
    await new Promise((resolve,reject)=>{const tx=legacy.transaction(stores,'readwrite');for(const store of stores){if(store==='settings')tx.objectStore(store).put('http://kept-laptop','laptopUrl');else tx.objectStore(store).put({id:'retained',name:store,dataUrl:'kept-photo'});}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    legacy.close();
    const ctx=vm.createContext({indexedDB:idb,console});vm.runInContext(fs.readFileSync('mobile-app/src/js/waypoint-store.js','utf8'),ctx);
    await vm.runInContext('openWpDB()',ctx);
    for(const store of stores){ctx.name=store;const result=await vm.runInContext('new Promise((resolve,reject)=>{const tx=wpDB.transaction(name);const r=tx.objectStore(name).get(name==="settings"?"laptopUrl":"retained");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})',ctx);if(store==='settings')assert.equal(result,'http://kept-laptop');else assert.equal(result.name,store);}
    assert.equal(await vm.runInContext('wpDB.objectStoreNames.contains("orders")',ctx),true);
    vm.runInContext('wpDB.close()',ctx);
  }
});

test('Windows release uses stable per-user storage independent of install directory',()=>{
  const {getDataHome}=require('../packaging/launcher.cjs');
  const contract=require('../release-contract.json');
  assert.equal(getDataHome({LOCALAPPDATA:'C:/Users/Example/AppData/Local'}),path.join('C:/Users/Example/AppData/Local',contract.windowsDataFolder));
  assert.equal(getDataHome({LOCALAPPDATA:'C:/Other',FIELDMAPPER_HOME:'D:/ExplicitData'}),'D:/ExplicitData');
});
