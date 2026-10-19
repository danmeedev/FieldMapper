const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {execFileSync,spawnSync} = require('node:child_process');
const script=path.resolve('scripts/check-privacy.cjs');
function repo(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fieldmapper-privacy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 git('init','--quiet');git('config','user.name','Privacy Test');git('config','user.email','privacy@example.invalid');
 fs.writeFileSync(path.join(dir,'README.md'),'Fixture');git('add','README.md');git('commit','--quiet','-m','Fixture');
 return {dir,git,check:()=>spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'})};}
test('privacy gate allows ignored personal data and rejects it if force-added',t=>{
 const r=repo(t);fs.writeFileSync(path.join(r.dir,'.gitignore'),'data/\n');fs.mkdirSync(path.join(r.dir,'data'));fs.writeFileSync(path.join(r.dir,'data','waypoints.json'),'[{"id":"private-fixture"}]');
 assert.equal(r.check().status,0);r.git('add','-f','data/waypoints.json');const result=r.check();assert.equal(result.status,1);assert.match(result.stderr,/Tracked private path/);
});
test('privacy gate detects database history after removal from the current tree',t=>{
 const r=repo(t);fs.writeFileSync(path.join(r.dir,'personal.db'),'fixture database');r.git('add','personal.db');r.git('commit','--quiet','-m','Fixture database');r.git('rm','personal.db');r.git('commit','--quiet','-m','Remove fixture');
 const result=r.check();assert.equal(result.status,1);assert.match(result.stderr,/Private path in reachable history/);
});
test('privacy gate reports credential location without printing its value',t=>{
 const r=repo(t);const credential=['sk','ant','X'.repeat(35)].join('-');fs.writeFileSync(path.join(r.dir,'accidental.txt'),credential);r.git('add','accidental.txt');r.git('commit','--quiet','-m','Fixture credential');
 const result=r.check();assert.equal(result.status,1);assert.match(result.stderr,/Credential pattern/);assert(!result.stderr.includes(credential));
});
