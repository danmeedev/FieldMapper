const fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('child_process');
const {createHash}=require('crypto');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const build=JSON.parse(fs.readFileSync('dist/latest-build.json','utf8').replace(/^\uFEFF/,''));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fieldmapper-package-'));
  const quote=s=>"'"+s.replace(/'/g,"''")+"'";
  let child,output='';
  try {
    execFileSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(build.zip)} -DestinationPath ${quote(temp)}`]);
    const bundle=path.join(temp,fs.readdirSync(temp).find(n=>n.startsWith('FieldMapper-')));
    const pc=path.join(bundle,'PC'),app=path.join(pc,'app');
    for(const name of ['data','tiles','certs','config.json','.review-logs'])assert.equal(fs.existsSync(path.join(app,name)),false,name+' must not ship');
    assert.equal(fs.existsSync(path.join(app,'node_modules','playwright')),false);
    assert.equal(fs.existsSync(path.join(app,'node_modules','marked')),false);
    const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else files.push(p)}}walk(bundle);
    assert.equal(files.some(f=>/\.(p12|jks|keystore|pem|pfx|key|db(?:-[\w]+)?|sqlite3?(?:-[\w]+)?)$/i.test(f)),false);
    // Byte-for-byte comparison against local records/photos catches accidental inclusion under another name.
    const privateHashes=new Set();
    function collectPrivate(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collectPrivate(file);else privateHashes.add(createHash('sha256').update(fs.readFileSync(file)).digest('hex'));}}
    for(const dir of ['data','field-data','certs'])collectPrivate(dir);
    if(fs.existsSync('config.json'))privateHashes.add(createHash('sha256').update(fs.readFileSync('config.json')).digest('hex'));
    for(const file of files)assert.equal(privateHashes.has(createHash('sha256').update(fs.readFileSync(file)).digest('hex')),false,'Local private file must not ship: '+path.relative(bundle,file));
    for(const file of ['START HERE.html','README.html','QUICK-SETUP.html','PC/Start Field Mapper.cmd','PC/Open My Field Mapper Data.cmd'])assert.ok(fs.existsSync(path.join(bundle,file)),file);
    const apk=files.find(f=>/Android.*\.apk$/.test(f));const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');assert.equal(hash(apk),hash(build.apk));
    console.log('PASS extracted ZIP includes runtime, launchers, guides, production dependencies, signed APK; no private data or keys');
    const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
    const home=path.join(temp,'fresh-user-data');
    const env={...process.env,PATH:'',NODE_PATH:'',NODE_OPTIONS:'',ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:'',FIELDMAPPER_AUTH_TOKEN:'',FIELDMAPPER_HOME:home,FIELDMAPPER_PORT:String(port),FIELDMAPPER_NO_BROWSER:'1'};
    const runtime=path.join(pc,'runtime','node.exe');
    child=spawn(runtime,[path.join(pc,'launcher.cjs')],{cwd:os.tmpdir(),env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const base=`http://localhost:${port}`;let status;
    for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/status');if(r.ok){status=await r.json();break}}catch{}await delay(100)}
    assert.equal(status?.server,'Field Mapper Laptop Server',output);assert.ok(Array.isArray(status.connectionUrls));
    assert.match(await(await fetch(base)).text(),/Connect your Android phone/);
    assert.match(await(await fetch(base+'/js/connection-info.js')).text(),/refreshConnectionInfo/);
    assert.equal((await(await fetch(base+'/api/ai/status')).json()).ready,false);
    assert.equal((await(await fetch(base+'/api/waypoints')).json()).length,0);
    console.log('PASS first startup works without installed Node/OpenSSL, from another working directory, with empty data and AI hidden');
    await fetch(base+'/api/waypoint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'package-test',name:'Disposable package smoke',lat:0,lon:0})});
    assert.equal(JSON.parse(fs.readFileSync(path.join(home,'data','waypoints.json')))[0].id,'package-test');
    assert.equal(fs.existsSync(path.join(app,'data')),false);assert.equal(fs.existsSync(path.join(app,'certs')),false);
    const duplicate=spawn(runtime,[path.join(pc,'launcher.cjs')],{cwd:os.tmpdir(),env,stdio:['ignore','pipe','pipe']});let duplicateOutput='';duplicate.stdout.on('data',b=>duplicateOutput+=b);
    const exit=await new Promise(r=>duplicate.once('exit',r));assert.equal(exit,0);assert.match(duplicateOutput,/already running/);
    console.log('PASS personal data stays outside app folder and repeated startup reuses server');
    // A new installation directory must reuse the same personal store.
    for(const [endpoint,record] of [['route',{id:'keep-route',points:[]}],['specimen',{id:'keep-specimen'}],['digorder',{id:'keep-dig'}],['order',{id:'keep-order'}]]) {
      const r=await fetch(base+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});assert.equal(r.ok,true);
    }
    await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aiEnabled:false,aiModel:'claude-sonnet-4-6'})});
    fs.mkdirSync(path.join(home,'tiles'),{recursive:true});fs.writeFileSync(path.join(home,'tiles','retained.bin'),'cached-map');
    fs.writeFileSync(path.join(home,'data','photos','retained.jpg'),'photo-bytes');
    await fetch(base+'/api/track-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'keep-track',name:'Persisted track',points:[{lat:0,lon:0,timestamp:1}]})});
    await fetch(base+'/api/waypoint/deleted-marker?deletedAt=123456',{method:'DELETE'});
    const tombstonesBefore=fs.readFileSync(path.join(home,'data','tombstones.json'),'utf8');
    const configBefore=fs.readFileSync(path.join(home,'config.json'),'utf8');
    execFileSync('C:/Windows/System32/taskkill.exe',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});await delay(500);child=null;
    const replacement=path.join(temp,'replacement-version');fs.cpSync(pc,replacement,{recursive:true});
    child=spawn(path.join(replacement,'runtime','node.exe'),[path.join(replacement,'launcher.cjs')],{cwd:os.tmpdir(),env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    let restarted=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok){restarted=true;break}}catch{}await delay(100)}assert.ok(restarted,output);
    for(const [endpoint,id]of [['waypoints','package-test'],['routes','keep-route'],['specimens','keep-specimen'],['digorders','keep-dig'],['orders','keep-order'],['track-sessions','keep-track']])assert.ok((await(await fetch(base+'/api/'+endpoint)).json()).some(r=>r.id===id));
    assert.equal(fs.readFileSync(path.join(home,'config.json'),'utf8'),configBefore);
    assert.equal(fs.readFileSync(path.join(home,'data','tombstones.json'),'utf8'),tombstonesBefore);
    assert.equal(fs.readFileSync(path.join(home,'tiles','retained.bin'),'utf8'),'cached-map');
    assert.equal(fs.readFileSync(path.join(home,'data','photos','retained.jpg'),'utf8'),'photo-bytes');
    console.log('PASS replacement installation preserves waypoints/routes/specimens/orders/dig orders, tracks/tombstones, photos, settings and tiles');
    fs.writeFileSync('.review-logs/package-launcher.log',output);
    fs.writeFileSync('.review-logs/package-verification.json',JSON.stringify({runtime:build.runtime,zipSHA256:hash(build.zip),apkSHA256:hash(build.apk),checksPassed:true},null,2));
  } finally {
    if(child&&child.exitCode===null){try{execFileSync('C:/Windows/System32/taskkill.exe',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'})}catch{}await delay(300);}
    if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('fieldmapper-package-'))fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
