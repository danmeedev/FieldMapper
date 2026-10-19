const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {newer, configured, release} = require('../public/js/app-updates');
const config = {repository:'example/mapper',branch:'release/stable',currentVersion:'1.1.0'};
const manifest = {version:'1.2.0',windows:'https://github.com/example/mapper/releases/download/v1.2.0/app.zip',android:'https://github.com/example/mapper/releases/download/v1.2.0/app.apk'};
function ui(saved, responder, confirmed=false) {
  const elements = Object.fromEntries(['updates-enabled','updates-status','updates-download','updates-check','updates-close'].map(id=>[id,{}]));
  const requests=[], downloads=[], store={value:saved ? JSON.stringify(saved) : null};
  const dialog={style:{},querySelector:selector=>elements[selector.slice(1)],showModal(){this.open=true;},close(){this.open=false;}};
  const document={hidden:false,body:{appendChild(){}},addEventListener(){},createElement(tag){return tag==='dialog'?dialog:{click(){downloads.push(this.href);},remove(){}};}};
  const context={document,navigator:{onLine:true},localStorage:{getItem:()=>store.value,setItem:(k,v)=>store.value=v},URL,AbortSignal,Date,
    setInterval(){},addEventListener(){},confirm:()=>confirmed,fetch:async url=>{requests.push(url);return responder(url);}};
  context.window=context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/app-updates'),'utf8'),context);
  return {context,elements,requests,downloads,store,dialog};
}
const response = value=>({ok:true,json:async()=>value});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('stable version comparison and release trust boundary',()=>{
  assert(newer('1.10.0','1.9.9')); assert(!newer('1.1.0','1.1.0')); assert(!newer('1.2.0-beta','1.1.0'));
  assert(!configured({...config,branch:'PLACEHOLDER_BRANCH'}));
  assert.equal(release(config,manifest,'android').url,manifest.android);
  for(const url of ['http://github.com/example/mapper/releases/download/v/a.zip','https://evil.test/a.zip','https://github.com/other/repo/releases/download/v/a.zip','https://github.com/example/mapper/releases/download/v/a.exe'])
    assert.throws(()=>release(config,{...manifest,windows:url},'windows'));
});
test('disabled setting survives startup; manual check offers update but never downloads until confirmation',async()=>{
  const app=ui({enabled:false,lastCheck:0},url=>response(url==='update-config.json'?config:manifest));
  assert.equal(app.requests.length,0);
  await app.context.AppUpdates.check(true);
  assert.equal(app.requests.length,2); assert(app.requests[1].includes('ref=release%2Fstable'));
  assert.equal(app.dialog.open,true);assert.equal(app.downloads.length,0);
  app.elements['updates-download'].onclick(); assert.equal(app.downloads.length,0);
  assert.equal(JSON.parse(app.store.value).enabled,false);
});
test('explicit approval opens only the selected release download',async()=>{
  const app=ui({enabled:false},url=>response(url==='update-config.json'?config:manifest),true);
  await app.context.AppUpdates.check(true); app.elements['updates-download'].onclick();
  assert.deepEqual(app.downloads,[manifest.windows]);
});
test('placeholder source never calls GitHub',async()=>{
  const app=ui(null,()=>response({...config,repository:'PLACEHOLDER_OWNER/PLACEHOLDER_REPOSITORY'}));
  await settle(); assert.deepEqual(app.requests,['update-config.json']); assert.equal(app.downloads.length,0);
});
test('turning automatic checks off suppresses an in-flight offer',async()=>{
  let finish;
  const app=ui(null,url=>url==='update-config.json'?response(config):new Promise(resolve=>finish=()=>resolve(response(manifest))));
  await settle(); app.elements['updates-enabled'].checked=false;app.elements['updates-enabled'].onchange();
  finish();await settle();assert(!app.dialog.open);assert(app.elements['updates-download'].hidden);assert.equal(app.downloads.length,0);
  assert.equal(JSON.parse(app.store.value).enabled,false);
});
test('successful automatic checks are throttled across restart',()=>{
  const app=ui({enabled:true,lastCheck:Date.now()},()=>{throw Error('must not request');});
  assert.equal(app.requests.length,0);
});
test('PC and Android use identical checker and correct installed version',()=>{
  assert.equal(fs.readFileSync('public/js/app-updates.js','utf8'),fs.readFileSync('mobile-app/src/js/app-updates.js','utf8'));
  for(const base of ['public','mobile-app/src']) assert.equal(JSON.parse(fs.readFileSync(base+'/update-config.json')).currentVersion,require('../package.json').version);
});
