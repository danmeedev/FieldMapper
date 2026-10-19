// Print paths and counts only: never print credentials or database contents.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const git = (...args) => execFileSync('git', args, {maxBuffer:128*1024*1024});
const privatePath = /(^|\/)(data|field-data|tiles|certs|backups|exports|signing|\.review-backup|\.review-logs)\/|(^|\/)(config\.json|\.env(?:\..*)?)$|\.(?:db(?:-[\w]+)?|sqlite3?(?:-[\w]+)?|jks|keystore|p12|pem|pfx|key|bak|backup|dump|tar|tgz)$/i;
const localPath = /(^|\/)\.claude\/settings\.local\.json$|^mobile-app\/\.idea\//;
const secret = /sk-ant-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const allowed = p => /(^|\/)\.env\.example$/.test(p);
const tracked = git('ls-files','-z').toString().split('\0').filter(Boolean);
const failures = new Set();
for (const p of tracked) if (!allowed(p) && (privatePath.test(p) || localPath.test(p))) failures.add('Tracked private path: ' + p);
const objects = git('rev-list','--objects','--all').toString().trim().split('\n').filter(Boolean);
const names = new Map();
for (const line of objects) {
 const space=line.indexOf(' '); if(space<0) continue;
 const oid=line.slice(0,space), p=line.slice(space+1); names.set(oid,p);
 if(!allowed(p) && privatePath.test(p)) failures.add('Private path in reachable history: ' + p);
}
for(const p of tracked) if(fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size<2000000 && secret.test(fs.readFileSync(p,'utf8')))
 failures.add('Credential pattern in working tree: ' + p);
const metadata = execFileSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:[...names.keys()].join('\n')+'\n',maxBuffer:128*1024*1024}).toString().trim().split('\n');
const blobs=metadata.filter(line=>{const [,kind,size]=line.split(' ');return kind==='blob' && Number(size)<2000000;}).map(line=>line.split(' ')[0]);
if(blobs.length) {
 const data=execFileSync('git',['cat-file','--batch'],{input:blobs.join('\n')+'\n',maxBuffer:128*1024*1024});
 let offset=0;
 while(offset<data.length){const end=data.indexOf(10,offset);const [oid,,size]=data.subarray(offset,end).toString().split(' ');const start=end+1;const length=Number(size);
 if(!Number.isFinite(length)) throw Error('Unexpected Git object metadata');
 if(secret.test(data.subarray(start,start+length).toString())) failures.add('Credential pattern in history: '+names.get(oid));
 offset=start+length+1;}
}
if(failures.size){for(const failure of failures)console.error(failure);process.exitCode=1;}
else console.log(`PASS privacy: ${tracked.length} tracked files and ${blobs.length} historical blobs checked; no private data paths or recognized credentials found.`);
