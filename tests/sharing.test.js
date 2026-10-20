const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const S=require('../public/js/share-format');
const {createStore,commitFiles,recover}=require('../server/sharing-store');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fieldmapper-sharing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const record=(type,id,data)=>({type,localId:id,data:{id,...data}});
const snapshot=records=>({source:'sender-one',records,state:{source:'sender-one',imports:{},opaque:{},forwardedPackages:[]}});
const receiver=records=>{const s=snapshot(records);s.source=s.state.source='receiver';return s;};
const point=(id,name='Point')=>record('waypoints',id,{name,lat:0,lon:0,notes:'Original notes',futureField:{value:123}});
async function pkg(records,options={}){return (await S.pack(snapshot(records),records.map(r=>S.localKey(r.type,r.localId)),options)).package;}
function mobile(extra={}){
 const ctx=vm.createContext({console,indexedDB:new IDBFactory(),IDBKeyRange,crypto:crypto.webcrypto,TextEncoder,TextDecoder,Buffer,Uint8Array,DataView,...extra});
 for(const file of ['share-format','waypoint-store','sharing-local'])vm.runInContext(fs.readFileSync('mobile-app/src/js/'+file+'.js','utf8'),ctx);
 return {ctx,run:code=>vm.runInContext(code.includes(';')?'(async()=>{'+code+'})()':'(async()=>('+code+'))()',ctx)};
}
test('sharing SHA-256, canonical JSON, and identical PC/Android implementations',()=>{
 for(const text of ['', 'abc', '🪨'.repeat(1000)])assert.equal(S.digestSync(text),crypto.createHash('sha256').update(text).digest('hex'));
 assert.equal(S.canonical({b:2,a:1}),S.canonical({a:1,b:2}));
 for(const file of ['share-format','sharing-ui'])assert.equal(fs.readFileSync('public/js/'+file+'.js','utf8'),fs.readFileSync('mobile-app/src/js/'+file+'.js','utf8'));
});
test('selection excludes other records/photos; selected photos deduplicate and verify',async()=>{
 const image='data:image/png;base64,'+Buffer.from('fixture-image').toString('base64');
 const records=[point(0),point(2,'Do not send')];records[0].data.photos=[image,image];records[1].data.photos=['https://never-fetch.invalid/photo.jpg'];
 const file=(await S.pack(snapshot(records),[S.localKey('waypoints',0)])).package;
 assert.equal(file.records.length,1);assert.equal(file.records[0].origin.id,'0');assert.equal(file.attachments.length,1);
 assert(!JSON.stringify(file).includes('Do not send'));assert(!JSON.stringify(file).includes('never-fetch'));
 assert.equal((await S.parse(file)).records[0].data.lat,0);
 const bad=S.clone(file);bad.attachments[0].data=Buffer.from('corrupt').toString('base64');await assert.rejects(S.parse(bad),/checksum/);
});
test('linked records are opt-in, links remap to new local IDs without collisions',async()=>{
 const records=[point(1),record('specimens',2,{name:'Rock',waypointId:1})];
 let file=(await S.pack(snapshot(records),[S.localKey('specimens',2)])).package;assert.equal(file.records.length,1);
 let p=await S.plan(file,receiver([point(1,'Unrelated receiver point')]),{supported:S.TYPES});
 assert.equal(p.changes[0].data.waypointId,null);assert(p.warnings.length);
 file=(await S.pack(snapshot(records),[S.localKey('specimens',2)],{includeLinked:true})).package;assert.equal(file.records.length,2);
 const local=snapshot([point(1,'Unrelated receiver point')]);local.source=local.state.source='receiver';
 p=await S.plan(file,local);const wp=p.changes.find(c=>c.type==='waypoints'),sp=p.changes.find(c=>c.type==='specimens');
 assert.notEqual(wp.localId,1);assert.equal(sp.data.waypointId,wp.localId);assert.notEqual(sp.localId,wp.localId);
});
test('missing and forged reference identities cannot link to unrelated local records',async()=>{
 const file=await pkg([record('orders',7,{items:[{specimenId:999,name:'unavailable'}]})]);
 const parsed=await S.parse(file);const plan=await S.plan(parsed,receiver([record('specimens',999,{name:'unrelated'})]));
 assert.equal(plan.changes[0].data.items[0].specimenId,null);
 const forged=S.clone(file);delete forged.records[0].links;await assert.rejects(S.parse(forged),/portable identity/);
});
test('receiver imports preserve its originals; repeated packages skip; replacement requires explicit choice',async t=>{
 const dir=temp(t),store=createStore(dir);fs.writeFileSync(path.join(dir,'waypoints.json'),JSON.stringify([point(1,'Keep me').data]));
 const file=await pkg([point(1)]);let {plan}=await store.preview(file);assert.equal(plan.counts.add,1);
 await store.apply(file,{revision:plan.revision});let rows=store.snapshot().records.filter(r=>r.type==='waypoints');assert.equal(rows.length,2);assert.equal(rows.find(r=>r.localId===1).data.name,'Keep me');
 ({plan}=await store.preview(file));assert.equal(plan.counts.skip,1);await store.apply(file,{revision:plan.revision});assert.equal(store.snapshot().records.filter(r=>r.type==='waypoints').length,2);
 const changed=S.clone(file);changed.records[0].data.name='Sender changed';
 ({plan}=await store.preview(changed));assert.equal(plan.counts.skip,1);
 ({plan}=await store.preview(changed,{update:true}));assert.equal(plan.counts.update,1);await store.apply(changed,{revision:plan.revision,update:true});
 assert(store.snapshot().records.some(r=>r.data.name==='Sender changed'));assert(store.snapshot().records.some(r=>r.data.name==='Keep me'));
});
test('application versions and additive metadata do not gate compatibility; future types/schema round-trip intact',async t=>{
 const dir=temp(t),store=createStore(dir),file=await pkg([record('future-type',12,{name:'Future',newGeometry:{a:[1,2]},extension:{meaning:'unchanged'}})]);
 file.version.minor=99;file.producer={appVersion:'999.999.999'};file.projectNotes={keep:'original package metadata'};file.records[0].schema=27;file.records[0].futureEnvelope={flag:true};
 const {plan}=await store.preview(file);assert.equal(plan.counts.preserved,1);await store.apply(file,{revision:plan.revision});
 const local=store.snapshot(),result=await store.exportPackage(local.records.map(r=>S.localKey(r.type,r.localId)),{includePackageMetadata:true});
 assert.deepEqual(result.package.records[0],file.records[0]);assert(result.package.extensions.forwardedPackages.some(p=>p.projectNotes?.keep==='original package metadata'));
 const plain=await store.exportPackage(local.records.map(r=>S.localKey(r.type,r.localId)));assert.equal(plain.package.extensions.forwardedPackages.length,0);
 const future=S.clone(file);future.version.major=2;await assert.rejects(store.preview(future),/Unsupported sharing protocol/);assert.equal(store.snapshot().records.length,1);
});
test('malicious rich text is preserved as opaque data and never reaches legacy map renderers',async t=>{
 const store=createStore(temp(t)),file=await pkg([point(1,'<img src=x onerror=alert(1)>')]);const {plan}=await store.preview(file);
 assert.equal(plan.counts.preserved,1);await store.apply(file,{revision:plan.revision});assert(store.snapshot().records[0].opaque);
});
test('prototype keys, invalid coordinates, incomplete photos and remote image references reject before writes',async()=>{
 const file=await pkg([point(1)]);const poison=JSON.stringify(file).replace('"futureField":','"__proto__":{"polluted":true},"futureField":');await assert.rejects(S.parse(poison),/Unsafe object key/);
 const bad=S.clone(file);bad.records[0].data.lat=91;await assert.rejects(S.parse(bad),/coordinates/);
 bad.records[0].data.lat=0;bad.records[0].data.photos=['https://never-fetch.invalid/photo.jpg'];await assert.rejects(S.parse(bad),/remote\/file paths/);
 bad.records[0].data.photos=['fieldmapper-asset:'+'a'.repeat(64)];await assert.rejects(S.parse(bad),/Missing photo/);
 assert.equal({}.polluted,undefined);
});
test('legacy Field Mapper waypoint/route exports are adapted without matching app version',async()=>{
 const file=await S.parse({waypoints:[point(0).data],exportDate:'old export'});assert.equal(file.records[0].type,'waypoints');assert(file.extensions.legacyImport);
 const route=await S.parse({id:'old-route',name:'Legacy',points:[{lat:0,lon:0}]});assert.equal(route.records[0].type,'routes');
});
test('PC transaction rollback restores records/state/photos after an interrupted write',t=>{
 const dir=temp(t);fs.writeFileSync(path.join(dir,'waypoints.json'),'old');fs.mkdirSync(path.join(dir,'photos'));
 assert.throws(()=>commitFiles(dir,new Map([['waypoints.json','new'],['sharing-state.json','{}']]),()=>{throw Error('simulated disk failure');}),/disk failure/);
 assert.equal(fs.readFileSync(path.join(dir,'waypoints.json'),'utf8'),'old');assert.equal(fs.existsSync(path.join(dir,'sharing-state.json')),false);assert.equal(fs.existsSync(path.join(dir,'.sharing-transaction')),false);
});
test('startup recovers a prepared transaction after a process crash',t=>{
 const dir=temp(t),tx=path.join(dir,'.sharing-transaction');fs.mkdirSync(tx);fs.writeFileSync(path.join(dir,'waypoints.json'),'partly-imported');fs.writeFileSync(path.join(tx,'before-0'),'original');fs.writeFileSync(path.join(tx,'journal.json'),JSON.stringify({committed:false,files:[{name:'waypoints.json',before:true}]}));recover(dir);assert.equal(fs.readFileSync(path.join(dir,'waypoints.json'),'utf8'),'original');
});
test('stale import preview is rejected rather than overwriting intervening edits',async t=>{
 const dir=temp(t),store=createStore(dir),file=await pkg([point(1)]),{plan}=await store.preview(file);fs.writeFileSync(path.join(dir,'routes.json'),JSON.stringify([{id:7,name:'new local edit',points:[]}]));
 await assert.rejects(store.apply(file,{revision:plan.revision}),/Local data changed/);assert.equal(store.snapshot().records.length,1);
});
test('PC -> Android -> PC preserves photos, user fields and original identities offline',async t=>{
 const dir=temp(t),source=createStore(dir),image=Buffer.from('offline-photo');fs.writeFileSync(path.join(dir,'photos','photo.jpg'),image);fs.writeFileSync(path.join(dir,'waypoints.json'),JSON.stringify([{...point(1).data,photos:['photo.jpg']}]))
 const file=(await source.exportPackage([S.localKey('waypoints',1)])).package;
 const m=mobile();m.ctx.file=file;await m.run('openWpDB()');await m.run('saveWaypoint({id:1,name:"Receiver original",lat:1,lon:1})');await m.run('globalThis.previewed=await SharingLocal.preview(file); await SharingLocal.apply(previewed)');
 assert.equal(await m.run('(await getAllWaypoints()).length'),2);
 const received=await m.run('(await getAllWaypoints()).find(r=>r.id!==1)');assert.equal(received.futureField.value,123);
 m.ctx.receivedId=received.id;assert.equal((await m.run('getPhotos(receivedId)'))[0].dataUrl,'data:image/jpeg;base64,'+image.toString('base64'));
 const outgoing=await m.run('SharingLocal.exportPackage([FieldShare.localKey("waypoints",receivedId)],{})');
 assert.deepEqual(JSON.parse(JSON.stringify(outgoing.package.records[0].origin)),file.records[0].origin);
 assert.equal(outgoing.package.attachments[0].id,file.attachments[0].id);
 const {plan}=await source.preview(outgoing.package);assert.equal(plan.counts.skip,1);
});
test('Android import transaction rejects a changed database and does not partially insert',async()=>{
 const m=mobile(),file=await pkg([point(7)]);m.ctx.file=file;await m.run('globalThis.previewed=await SharingLocal.preview(file)');await m.run('saveWaypoint({id:99,name:"Edit after preview",lat:1,lon:1})');await assert.rejects(m.run('SharingLocal.apply(previewed)'),/Local data changed/);assert.equal(await m.run('(await getAllWaypoints()).length'),1);
});
test('native SQLite recordings are exportable without laptop/network; recipient uses portable track records',async()=>{
 const m=mobile({NativeGps:{isNative:true,isTracking:false,getSessions:async()=>[{id:1,name:'Native recording',startTime:1,endTime:2,active:false}],getSessionPoints:async()=>[{lat:0,lng:0,alt:5,accuracy:3,timestamp:1}]}});
 const value=await m.run('SharingLocal.snapshot()');assert(value.records.some(r=>r.native));
 const result=await m.run('SharingLocal.exportPackage([FieldShare.localKey("trackSessions","native:1")],{})');assert.equal(result.package.records[0].data.points[0].accuracy,3);assert.equal(result.package.records[0].data.points[0].lng,0);
});
test('v6 -> v7 adds sharing/index without losing field records, photos, or settings',async()=>{
 const idb=new IDBFactory();await new Promise((resolve,reject)=>{const r=idb.open('fieldmapper-data',6);r.onupgradeneeded=()=>{for(const s of ['waypoints','photos'])r.result.createObjectStore(s,{keyPath:'id'});r.result.createObjectStore('settings');};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['waypoints','photos','settings'],'readwrite');tx.objectStore('waypoints').put({id:1,name:'retained',lat:0,lon:0});tx.objectStore('photos').put({id:'1-0',waypointId:1,dataUrl:'retained-photo'});tx.objectStore('settings').put('private-laptop','laptopUrl');tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});
 const m=mobile({indexedDB:idb});assert.equal(await m.run('(await getAllWaypoints())[0].name'),'retained');assert.equal(await m.run('(await getPhotos(1))[0].dataUrl'),'retained-photo');assert.equal(await m.run('getSetting("laptopUrl")'),'private-laptop');assert.equal(await m.run('wpDB.version'),7);
});
test('a newer unsupported record schema retains the readable copy and exports distinct identities',async t=>{
 const store=createStore(temp(t)),first=await pkg([point(1)]);let {plan}=await store.preview(first);await store.apply(first,{revision:plan.revision});
 const newer=S.clone(first);newer.packageId=S.uuid();newer.records[0].schema=2;newer.records[0].data.name='Future revision';
 ({plan}=await store.preview(newer,{update:true}));await store.apply(newer,{revision:plan.revision,update:true});
 const local=store.snapshot();assert.equal(local.records.length,2);assert.equal(local.records.filter(r=>r.opaque).length,1);
 const exported=await store.exportPackage(local.records.map(r=>S.localKey(r.type,r.localId)));await S.parse(exported.package);assert.equal(new Set(exported.package.records.map(S.key)).size,2);
});
test('future attachment media stays opaque and round-trips; photo opt-out removes its bytes',async t=>{
 const store=createStore(temp(t)),file=await pkg([record('audio-notes',1,{name:'New attachment kind'})]);
 const bytes=Buffer.from('future-audio'),id=await S.hash(bytes);file.attachments=[{id,mediaType:'audio/ogg',encoding:'base64',bytes:bytes.length,data:bytes.toString('base64')}];file.records[0].data.audio='fieldmapper-asset:'+id;
 const {plan}=await store.preview(file);await store.apply(file,{revision:plan.revision});const local=store.snapshot(),keys=local.records.map(r=>S.localKey(r.type,r.localId));
 const returned=await store.exportPackage(keys);assert.deepEqual(returned.package.attachments,file.attachments);await S.parse(returned.package);
 const omitted=await store.exportPackage(keys,{includePhotos:false});assert.equal(omitted.package.attachments.length,0);assert.equal(omitted.package.records[0].data.audio,null);
});
test('unrecognized fields survive an older form replacing the known fields',async t=>{
 const dir=temp(t),store=createStore(dir),file=await pkg([point(1)]);const {plan}=await store.preview(file);await store.apply(file,{revision:plan.revision});
 const imported=store.snapshot().records[0];fs.writeFileSync(path.join(dir,'waypoints.json'),JSON.stringify([{id:imported.localId,name:'Edited by old UI',lat:0,lon:0,notes:''}]));
 const result=await store.exportPackage([S.localKey('waypoints',imported.localId)]);assert.deepEqual(result.package.records[0].data.futureField,{value:123});assert.equal(result.package.records[0].data.notes,'');
});
test('GeoJSON overlays are shareable as preserved user data without reading config or tombstones',async t=>{
 const dir=temp(t),store=createStore(dir);fs.writeFileSync(path.join(dir,'area.geojson'),JSON.stringify({type:'FeatureCollection',features:[]}));fs.writeFileSync(path.join(dir,'config.json'),'{"secret":"do not share"}');fs.writeFileSync(path.join(dir,'tombstones.json'),'{"waypoints":{"1":123}}');
 const local=store.snapshot();assert.deepEqual(local.records.map(r=>r.type),['geojson']);const file=(await store.exportPackage(local.records.map(r=>S.localKey(r.type,r.localId)))).package;assert(!JSON.stringify(file).includes('do not share'));
});
test('a forged relation cannot rewrite coordinates or inject an arbitrary UI field type',async t=>{
 const store=createStore(temp(t)),file=await pkg([point(1)]);file.records[0].links=[{path:['lat'],type:'waypoints',origin:file.records[0].origin}];
 const {plan}=await store.preview(file);assert.equal(plan.counts.preserved,1);await store.apply(file,{revision:plan.revision});assert(store.snapshot().records[0].opaque);
 const malformed=await pkg([point(2)]);malformed.records[0].data.notes={unexpected:'object'};const checked=await store.preview(malformed);assert.equal(checked.plan.counts.preserved,1);
});
