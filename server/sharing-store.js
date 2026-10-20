const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Share=require('../public/js/share-format');
const FILES={waypoints:'waypoints.json',routes:'routes.json',specimens:'specimens.json',digOrders:'dig-orders.json',orders:'orders.json',trackSessions:'tracks.json'};
const MIME={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp'};
const STATE='sharing-state.json';
function allowed(name) {return Object.values(FILES).includes(name)||name===STATE||/^photos\/share-[a-f0-9]{64}\.(jpg|png|webp|gif|bmp)$/.test(name);}
function transactionDir(dir){const target=path.join(path.resolve(dir),'.sharing-transaction');if(path.dirname(target)!==path.resolve(dir))throw Error('Invalid transaction path.');return target;}
function durable(file,data){const fd=fs.openSync(file,'w');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function replace(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.sharing-temp';durable(temp,bytes);fs.renameSync(temp,file);}
function recover(dir) {
  const tx=transactionDir(dir);if(!fs.existsSync(tx))return;
  if(fs.lstatSync(tx).isSymbolicLink())throw Error('Invalid sharing transaction directory.');
  const journal=path.join(tx,'journal.json');
  if(fs.existsSync(journal)) {
    const j=JSON.parse(fs.readFileSync(journal,'utf8'));
    if(!Array.isArray(j.files)||!j.files.every(f=>typeof f.name==='string'&&allowed(f.name)))throw Error('Invalid sharing recovery journal; private files left untouched.');
    if(!j.committed)for(const [i,f]of j.files.entries()){
      const target=path.join(dir,f.name);
      if(f.before)replace(target,fs.readFileSync(path.join(tx,'before-'+i)));
      else if(fs.existsSync(target))fs.unlinkSync(target);
    }
  }
  fs.rmSync(tx,{recursive:true});
}
function commitFiles(dir,files,afterWrite) {
  recover(dir);const tx=transactionDir(dir);fs.mkdirSync(tx);
  const entries=[...files.entries()];
  const journal={committed:false,files:entries.map(([name])=>{if(!allowed(name))throw Error('Invalid sharing target.');return {name,before:fs.existsSync(path.join(dir,name))};})};
  try{
    for(const [i,[name,bytes]]of entries.entries()){
      if(journal.files[i].before)durable(path.join(tx,'before-'+i),fs.readFileSync(path.join(dir,name)));
      durable(path.join(tx,'after-'+i),bytes);
    }
    durable(path.join(tx,'journal.json'),JSON.stringify(journal));
    for(const [i,[name]]of entries.entries()) {replace(path.join(dir,name),fs.readFileSync(path.join(tx,'after-'+i)));afterWrite?.(i);}
    journal.committed=true;replace(path.join(tx,'journal.json'),JSON.stringify(journal));
    recover(dir);
  }catch(error){recover(dir);throw error;}
}
function createStore(dataDir) {
  dataDir=path.resolve(dataDir);fs.mkdirSync(dataDir,{recursive:true});recover(dataDir);
  const photosDir=path.join(dataDir,'photos');fs.mkdirSync(photosDir,{recursive:true});
  function read(name,fallback) {const file=path.join(dataDir,name);if(!fs.existsSync(file))return fallback;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Cannot read '+name+'. Repair/restore this local file before sharing.');}}
  function snapshot() {
    let state=read(STATE,null);
    if(!state){state={source:Share.uuid(),imports:{},opaque:{},forwardedPackages:[]};replace(path.join(dataDir,STATE),JSON.stringify(state));}
    const records=[];
    for(const [type,name]of Object.entries(FILES)) {
      const data=read(name,[]);if(!Array.isArray(data))throw Error('Invalid local '+type+' data.');
      for(const record of data){if(record.id==null)throw Error('Local '+type+' record has no ID.');records.push({type,localId:record.id,data:record});}
    }
    for(const name of fs.readdirSync(dataDir).filter(n=>n.endsWith('.geojson'))){
      if(fs.lstatSync(path.join(dataDir,name)).isSymbolicLink())throw Error('GeoJSON layer is outside the local data directory.');
      records.push({type:'geojson',localId:name,data:{id:name,name,geojson:read(name,null)}});
    }
    for(const [id,opaque]of Object.entries(state.opaque||{}))records.push({type:opaque.record.type,localId:'opaque:'+id,data:opaque.record.data,opaque});
    const mediaRevision=fs.readdirSync(photosDir).sort().map(name=>{const s=fs.lstatSync(path.join(photosDir,name));return [name,s.size,s.mtimeMs];});
    const value={source:state.source,state,records,mediaRevision};value.revision=Share.revision(value);return value;
  }
  function resolvePhoto(value) {
    const filename=String(value).split('/').at(-1).split('?')[0];
    if(!/^[a-zA-Z0-9_.-]+$/.test(filename)||filename==='.'||filename==='..')throw Error('Invalid local photo reference.');
    const file=path.join(photosDir,filename),mime=MIME[path.extname(filename).toLowerCase()];
    if(!mime||!fs.existsSync(file))return null;
    if(fs.lstatSync(file).isSymbolicLink()||path.dirname(fs.realpathSync(file))!==fs.realpathSync(photosDir))throw Error('Photo is outside the local photo directory.');
    return 'data:'+mime+';base64,'+fs.readFileSync(file).toString('base64');
  }
  async function exportPackage(selection,options){return Share.pack(snapshot(),selection,{...options,resolvePhoto});}
  async function preview(input,options={}){const file=await Share.parse(input),local=snapshot();const plan=await Share.plan(file,local,{...options,supported:Object.keys(FILES)});return {file,plan};}
  let importing=false;
  async function apply(input,options={}) {
    if(importing)throw Error('Another import is in progress.');importing=true;
    try{
      const {file,plan}=await preview(input,options);
      if(options.revision!==plan.revision)throw Error('Local data changed. Preview the file again before importing.');
      const imageFiles=new Map();
      const changes=[];
      for(const change of plan.changes)if(change.status!=='skip'&&change.supported){
        const data=await Share.mapStrings(change.data,(value,parts)=>{
          if(parts.at(-1)!=='photoRef'&&parts.at(-2)!=='photos'&&parts.at(-2)!=='photoData')return value;
          const image=Share.IMAGE.exec(value);if(!image)return value;
          const bytes=Buffer.from(image[2],'base64'),digest=crypto.createHash('sha256').update(bytes).digest('hex');
          const ext=image[1].split('/')[1].replace('jpeg','jpg'),name=`share-${digest}.${ext}`;
          imageFiles.set('photos/'+name,bytes);return name;
        });
        changes.push({...change,data});
      }
      const current=snapshot();
      if(current.revision!==plan.revision)throw Error('Local data changed. Preview the file again before importing.');
      if(!plan.changes.some(c=>c.status!=='skip'))return plan.counts;
      const files=new Map();
      for(const [type,name]of Object.entries(FILES)){
        const list=current.records.filter(r=>r.type===type&&!r.opaque).map(r=>r.data);
        for(const change of changes.filter(c=>c.type===type)){
          const i=list.findIndex(r=>String(r.id)===String(change.localId));if(i<0)list.push(change.data);else list[i]=change.data;
        }
        if(changes.some(c=>c.type===type))files.set(name,JSON.stringify(list,null,2));
      }
      for(const [name,bytes]of imageFiles){
        const existing=path.join(dataDir,name);
        if(!fs.existsSync(existing))files.set(name,bytes);
        else if(fs.lstatSync(existing).isSymbolicLink()||!fs.readFileSync(existing).equals(bytes))throw Error('An existing content-addressed photo is damaged. Nothing was imported.');
      }
      files.set(STATE,JSON.stringify(plan.state,null,2));commitFiles(dataDir,files);
      return plan.counts;
    }finally{importing=false;}
  }
  return {snapshot,exportPackage,preview,apply};
}
module.exports={createStore,commitFiles,recover,FILES};
