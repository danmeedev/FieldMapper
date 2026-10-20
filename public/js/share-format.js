/* Offline interchange protocol. App/database versions are deliberately not compatibility gates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FieldShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'fieldmapper-share';
  const MAX_BYTES = 32 * 1024 * 1024;
  const TYPES = ['waypoints', 'routes', 'specimens', 'digOrders', 'orders', 'trackSessions', 'measurements', 'trackLog', 'aiResults', 'preferences'];
  const RELATIONS = {waypointId:'waypoints', routeId:'routes', specimenId:'specimens', digOrderId:'digOrders'};
  const IMAGE = /^data:(image\/(?:jpeg|png|webp|gif|bmp));base64,([A-Za-z0-9+/]*={0,2})$/;
  const ASSET = /^fieldmapper-asset:([a-f0-9]{64})$/;
  const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function cryptoAPI() {
    if (globalThis.crypto?.subtle) return globalThis.crypto;
    if (typeof require === 'function') return require('node:crypto').webcrypto;
    throw Error('Open the PC app at localhost, or use the Android app, to create secure file checksums.');
  }
  function uuid() { return cryptoAPI().randomUUID(); }
  async function hash(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await cryptoAPI().subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
  }
  function bytes64(text) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text,'base64'));
    return Uint8Array.from(atob(text), c=>c.charCodeAt(0));
  }
  function key(record) { return JSON.stringify([record.origin.source, record.type, String(record.origin.id)]); }
  const localKey = (type,id) => JSON.stringify([type,String(id)]);
  function digestSync(text) {
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const input=new TextEncoder().encode(text), n=Math.ceil((input.length+9)/64)*64, bytes=new Uint8Array(n);bytes.set(input);bytes[input.length]=128;
    const view=new DataView(bytes.buffer);view.setUint32(n-8,Math.floor(input.length/0x20000000));view.setUint32(n-4,(input.length*8)>>>0);
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rr=(v,n)=>(v>>>n)|(v<<(32-n));
    for(let offset=0;offset<n;offset+=64){
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rr(a,7)^rr(a,18)^(a>>>3))+w[i-7]+(rr(b,17)^rr(b,19)^(b>>>10)))>>>0;}
      let[a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<64;i++){const t=(j+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0;const u=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0;}
      [a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
    }
    return h.map(v=>v.toString(16).padStart(8,'0')).join('');
  }
  function guard(value) {
    let count=0;
    function walk(v, depth) {
      if (++count > 1000000 || depth > 64) throw Error('Sharing file is too complex. Split it into smaller selections.');
      if (typeof v === 'number' && !Number.isFinite(v)) throw Error('Invalid numeric value.');
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        if (['__proto__','constructor','prototype'].includes(k)) throw Error('Unsafe object key in sharing file.');
        walk(v[k],depth+1);
      }
    }
    walk(value,0);
  }
  async function mapStrings(value, fn, path=[]) {
    if (typeof value === 'string') return fn(value,path);
    if (Array.isArray(value)) return Promise.all(value.map((v,i)=>mapStrings(v,fn,[...path,i])));
    if (value && typeof value === 'object') {
      const result={};
      for (const k of Object.keys(value)) result[k]=await mapStrings(value[k],fn,[...path,k]);
      return result;
    }
    return value;
  }
  function visit(value, fn, path=[]) {
    if (!value || typeof value !== 'object') return;
    for (const k of Object.keys(value)) {
      const p=[...path,Array.isArray(value)?Number(k):k];
      fn(value[k],k,p); visit(value[k],fn,p);
    }
  }
  function at(value,path) { for (const k of path) { if (value==null) return undefined; value=value[k]; } return value; }
  function put(value,path,replacement) {
    if (!path.length || path.length>64 || path.some(p=>!['string','number'].includes(typeof p)||['__proto__','constructor','prototype'].includes(p))) throw Error('Invalid relation path.');
    let target=value;
    for (const k of path.slice(0,-1)) { if (!target || typeof target!=='object' || !Object.hasOwn(target,k)) throw Error('Relation path does not exist.'); target=target[k]; }
    if (!target || typeof target!=='object' || !Object.hasOwn(target,path.at(-1))) throw Error('Relation path does not exist.');
    target[path.at(-1)]=replacement;
  }
  function safeToDisplay(data) {
    // Older map forms build HTML. Preserve rich/untrusted content as opaque data rather than rendering it.
    let safe=true;
    visit(data,(v,k)=>{
      if(['name','title','notes','label','category','color','pinColor','pinIcon'].includes(k)&&v!=null&&typeof v!=='string')safe=false;
      if (typeof v!=='string') return;
      if(['name','title','label','category'].includes(k)&&v.length>2000)safe=false;
      if (/<\s*[a-z!?/]|on[a-z]+\s*=|["'`]\s*[\w:-]+\s*=/i.test(v) || /^(javascript|vbscript):/i.test(v.replace(/[\x00-\x20]/g,''))) safe=false;
      if(/^data:/i.test(v)&&!IMAGE.test(v))safe=false;
      if ((k==='color'||k==='pinColor') && !/^#[a-f0-9]{3,8}$/i.test(v)) safe=false;
    });
    return safe;
  }
  function retainFields(original,current) {
    if(original&&current&&typeof original==='object'&&typeof current==='object'&&!Array.isArray(original)&&!Array.isArray(current)){
      const result=clone(original);for(const k of Object.keys(current))result[k]=retainFields(original[k],current[k]);return result;
    }
    if(Array.isArray(original)&&Array.isArray(current))return current.map(item=>{
      if(!item||typeof item!=='object')return clone(item);
      const matches=original.filter(old=>old&&typeof old==='object'&&((item.id!=null&&String(old.id)===String(item.id))||(item.id==null&&typeof item.lat==='number'&&old.lat===item.lat&&(old.lon??old.lng)===(item.lon??item.lng))));
      return matches.length===1?retainFields(matches[0],item):clone(item);
    });
    return clone(current);
  }
  function validateGeometry(data,type) {
    function position(p) {
      if (p.lat==null && p.lon==null && p.lng==null) return;
      const lon=p.lon??p.lng;
      if (typeof p.lat!=='number'||typeof lon!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(lon)||Math.abs(p.lat)>90||Math.abs(lon)>180) throw Error('Invalid coordinates in '+type+'.');
    }
    position(data);
    if (type==='waypoints' && (data.lat==null || (data.lon??data.lng)==null)) throw Error('A waypoint needs latitude and longitude.');
    if (data.points!=null) { if (!Array.isArray(data.points)) throw Error('Points must be an array.'); data.points.forEach(position); }
  }
  function revision(snapshot) {
    return digestSync(canonical({records:snapshot.records.filter(r=>r.type!=='trackLog'&&!r.native),state:snapshot.state,mediaRevision:snapshot.mediaRevision||null}));
  }
  function originFor(snapshot,record) {
    const saved=Object.values(snapshot.state.imports||{}).find(e=>e.type===record.type&&String(e.localId)===String(record.localId));
    return saved?.wire?.origin || {source:snapshot.source,id:String(record.localId)};
  }
  async function pack(snapshot, selected, options={}) {
    if(!Array.isArray(selected)||selected.some(k=>typeof k!=='string'))throw Error('A record selection must be an array of record keys.');
    for(const name of ['includeLinked','includePhotos','includePackageMetadata'])if(options[name]!=null&&typeof options[name]!=='boolean')throw Error('Invalid export option: '+name);
    const wanted=new Set(selected), records=[], attachments={}, warnings=[];
    const byLocal=new Map(snapshot.records.map(r=>[localKey(r.type,r.localId),r]));
    if (options.includeLinked) {
      let changed=true;
      while(changed) { changed=false; for (const r of snapshot.records) if(wanted.has(localKey(r.type,r.localId))) visit(r.data,(v,k)=>{
        const related=RELATIONS[k]&&byLocal.get(localKey(RELATIONS[k],v));
        if(related&&!wanted.has(localKey(related.type,related.localId))) {wanted.add(localKey(related.type,related.localId));changed=true;}
      }); }
    }
    for (const item of snapshot.records) {
      if (!wanted.has(localKey(item.type,item.localId))) continue;
      if(item.opaque) {
        const opaque=clone(item.opaque.record);
        if(options.includePhotos===false)opaque.data=await mapStrings(opaque.data,v=>ASSET.test(v)?null:v);
        else for(const asset of item.opaque.attachments) attachments[asset.id]=clone(asset);
        records.push(opaque);
        continue;
      }
      let data=clone(item.data);
      const saved=Object.values(snapshot.state.imports||{}).find(e=>e.type===item.type&&String(e.localId)===String(item.localId));
      if(saved)data=retainFields(saved.wire.data,data);
      const wire=saved?clone(saved.wire):{type:item.type,schema:1,origin:originFor(snapshot,item)};
      wire.type=item.type;wire.schema=1; wire.links=[];
      data.id=wire.origin.id;
      delete data.synced; delete data.updatedAt;
      if (item.type==='trackSessions') data.active=false;
      if(options.prepareData) data=await options.prepareData(item,data);
      visit(data,(v,k,path)=>{
        if(!RELATIONS[k]||v==null||v==='') return;
        const target=byLocal.get(localKey(RELATIONS[k],v));
        if(target) { const origin=originFor(snapshot,target);wire.links.push({path,type:target.type,origin}); put(data,path,origin.id); }
        else {
          const prior=Object.values(snapshot.state.imports||{}).find(e=>e.type===RELATIONS[k]&&String(e.localId)===String(v));
          wire.links.push({path,type:RELATIONS[k],origin:prior?.wire?.origin||{source:snapshot.source,id:String(v)}});
          warnings.push('A linked '+RELATIONS[k]+' record is unavailable; its reference is retained only as metadata.');
        }
      });
      for(const link of saved?.wire?.links||[]) if(at(data,link.path)==null && !wire.links.some(l=>canonical(l.path)===canonical(link.path))) {wire.links.push(clone(link));put(data,link.path,link.origin.id);}
      data=await mapStrings(data,async(value,path)=>{
        const photo=path.at(-1)==='photoRef'||path.at(-2)==='photos'||path.at(-2)==='photoData';
        const stored=ASSET.exec(value)?.[1], prior=stored&&saved?.attachments?.find(a=>a.id===stored);
        if(!photo&&!stored&&!IMAGE.test(value)) return value;
        if(options.includePhotos===false) return null;
        if(prior){attachments[prior.id]=clone(prior);return value;}
        const image=IMAGE.exec(value)||IMAGE.exec(await options.resolvePhoto?.(value,item)||'');
        if(!image) throw Error('A selected photo is not available locally. Cache/sync it first or export without photos.');
        const bytes=bytes64(image[2]);
        if(!bytes.length || bytes.length>MAX_BYTES) throw Error('Invalid or oversized photo.');
        const id=await hash(bytes);attachments[id]={id,mediaType:image[1],encoding:'base64',bytes:bytes.length,data:image[2]};
        return 'fieldmapper-asset:'+id;
      });
      function tidy(v) {if(!v||typeof v!=='object')return;for(const k of Object.keys(v)){if((k==='photos'||k==='photoData')&&Array.isArray(v[k]))v[k]=v[k].filter(x=>x!=null);else tidy(v[k]);}}
      tidy(data);wire.data=data;records.push(wire);
    }
    if(!records.length) throw Error('Select at least one record.');
    const sourcePackages=new Set(records.map(r=>snapshot.state.imports?.[key(r)]?.packageId).filter(Boolean));
    const forwarded=options.includePackageMetadata?(snapshot.state.forwardedPackages||[]).filter(p=>sourcePackages.has(p.packageId)):[];
    const result={format:FORMAT,version:{major:1,minor:0},packageId:uuid(),createdAt:new Date().toISOString(),records,attachments:Object.values(attachments),extensions:{forwardedPackages:clone(forwarded)}};
    if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_BYTES) throw Error('This selection exceeds the 32 MiB file limit. Export it in smaller selections.');
    return {package:result,warnings:[...new Set(warnings)]};
  }
  async function parse(input) {
    if(typeof input==='string' && new TextEncoder().encode(input).length>MAX_BYTES) throw Error('Sharing file exceeds 32 MiB.');
    if(typeof input!=='string'&&new TextEncoder().encode(JSON.stringify(input)).length>MAX_BYTES)throw Error('Sharing file exceeds 32 MiB.');
    let file;
    try {file=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):clone(input);}catch{throw Error('This is not valid JSON. Choose a Field Mapper sharing/export file.');}
    guard(file);
    if(!file||Array.isArray(file)||typeof file!=='object')throw Error('Choose a Field Mapper sharing/export object.');
    if(file.format!==FORMAT) {
      const types={waypoints:file.waypoints,routes:file.routes,specimens:file.specimens,digOrders:file.digOrders,orders:file.orders,trackSessions:file.trackSessions};
      if(file.points && file.id!=null && !file.routes) types.routes=[file];
      if(!Object.values(types).some(Array.isArray)) throw Error('This is not a supported Field Mapper sharing/export file.');
      const source='legacy-'+await hash(canonical(file));
      const records=[];
      for(const [type,list] of Object.entries(types)) if(Array.isArray(list)) for(const [i,data] of list.entries()) records.push({type,localId:data.id??i,data});
      file=(await pack({source,records,state:{}},records.map(r=>localKey(r.type,r.localId)),{resolvePhoto:()=>null})).package;
      file.extensions.legacyImport=true;
    }
    if(!file.version||file.version.major!==1||!Number.isSafeInteger(file.version.minor)||file.version.minor<0) throw Error('Unsupported sharing protocol. Nothing was imported; keep the original file for a compatible reader.');
    if(typeof file.packageId!=='string'||!file.packageId||file.packageId.length>200||!Array.isArray(file.records)||!file.records.length||file.records.length>100000||!Array.isArray(file.attachments)) throw Error('Invalid sharing file structure.');
    const attachments=new Map();let total=0;
    for(const asset of file.attachments) {
      if(!asset||!/^[a-f0-9]{64}$/.test(asset.id)||attachments.has(asset.id)||asset.encoding!=='base64'||typeof asset.mediaType!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.mediaType)||typeof asset.data!=='string'||!BASE64.test(asset.data)) throw Error('Invalid attachment.');
      const bytes=bytes64(asset.data);total+=bytes.length;
      if(!bytes.length||asset.data.length%4!==0||total>MAX_BYTES||bytes.length!==asset.bytes||await hash(bytes)!==asset.id) throw Error('Photo checksum/size mismatch. Nothing was imported.');
      attachments.set(asset.id,asset);
    }
    const seen=new Set();
    for(const r of file.records) {
      if(!r||typeof r.type!=='string'||!r.type||r.type.length>100||!r.origin||typeof r.origin.source!=='string'||!r.origin.source||r.origin.source.length>200||!['string','number'].includes(typeof r.origin.id)||!String(r.origin.id)||String(r.origin.id).length>512||!r.data||Array.isArray(r.data)||typeof r.data!=='object'||!Number.isSafeInteger(r.schema)||r.schema<1) throw Error('Invalid record identity/schema.');
      if(seen.has(key(r))) throw Error('Duplicate identity in sharing file.'); seen.add(key(r));
      for(const l of r.links||[]) {if(!l.origin||typeof l.origin.source!=='string'||!['string','number'].includes(typeof l.origin.id)||typeof l.type!=='string')throw Error('Invalid relation.');put(clone(r.data),l.path,at(r.data,l.path));}
      await mapStrings(r.data,(v,path)=>{
        if(v.startsWith('fieldmapper-asset:')&&!attachments.has(ASSET.exec(v)?.[1]))throw Error('Missing photo attachment.');
        if(r.schema===1&&TYPES.includes(r.type)&&(path.at(-1)==='photoRef'||path.at(-2)==='photos')&&!ASSET.test(v))throw Error('Photos must be embedded in the sharing file; remote/file paths are not imported.');
        return v;
      });
      if(r.schema===1&&TYPES.includes(r.type)){
        validateGeometry(r.data,r.type);
        visit(r.data,(v,k,path)=>{
          if(RELATIONS[k]&&v!=null&&v!==''&&!r.links?.some(l=>l.type===RELATIONS[k]&&canonical(l.path)===canonical(path)&&String(l.origin.id)===String(v)))throw Error('A record relation is missing its portable identity.');
        });
      }
    }
    return file;
  }
  async function plan(file,snapshot,options={}) {
    if(options.selected!=null&&(!Array.isArray(options.selected)||options.selected.some(k=>typeof k!=='string')))throw Error('Invalid incoming record selection.');
    if(options.update!=null&&typeof options.update!=='boolean')throw Error('Replacement must be an explicit boolean choice.');
    const selected=new Set(options.selected||file.records.map(key));
    const state=clone(snapshot.state), changes=[], warnings=[], ids=new Map();
    state.imports||={};state.opaque||={};state.forwardedPackages||=[];
    const reserved=new Set(snapshot.records.map(r=>String(r.localId)));
    let next=Date.now();
    const allocate=()=>{while(reserved.has(String(next)))next++;const id=next++;reserved.add(String(id));return id;};
    for(const [k,entry] of Object.entries(state.imports)) if(snapshot.records.some(r=>!r.opaque&&r.type===entry.type&&String(r.localId)===String(entry.localId)))ids.set(k,entry.localId);
    for(const r of snapshot.records) if(!r.opaque) ids.set(key({type:r.type,origin:originFor(snapshot,r)}),r.localId);
    const chosen=file.records.filter(r=>selected.has(key(r)));
    const assets=new Map(file.attachments.map(a=>[a.id,a]));
    for(const r of chosen) {
      const k=key(r), fingerprint=await hash(canonical(r)), previous=state.imports[k];
      const own=ids.has(k)&&!previous;
      if(own || (previous&&(previous.fingerprint===fingerprint||!options.update))) {changes.push({key:k,type:r.type,status:'skip',label:r.data.name||r.data.title||r.origin.id});continue;}
      let knownMedia=true;await mapStrings(r.data,v=>{const id=ASSET.exec(v)?.[1];if(id&&!/^image\/(jpeg|png|webp|gif|bmp)$/.test(assets.get(id).mediaType))knownMedia=false;return v;});
      const knownLinks=(r.links||[]).every(l=>RELATIONS[l.path.at(-1)]===l.type);
      const supported=(options.supported||TYPES).includes(r.type)&&r.schema===1&&safeToDisplay(r.data)&&knownMedia&&knownLinks;
      let localId=supported?ids.get(k):'opaque:'+k;if(localId==null)localId=allocate();
      const status=previous?'update':'add';
      if(supported) ids.set(k,localId); else ids.delete(k);
      changes.push({key:k,type:r.type,status,localId,wire:clone(r),fingerprint,supported,label:r.data.name||r.data.title||r.origin.id});
    }
    for(const change of changes) {
      if(change.status==='skip')continue;
      const r=change.wire,k=change.key;
      if(!change.supported) {
        const used=new Set();await mapStrings(r.data,v=>{const id=ASSET.exec(v)?.[1];if(id)used.add(id);return v;});
        state.opaque[k]={record:r,attachments:[...used].map(id=>clone(assets.get(id)))};
        warnings.push('Preserved '+r.type+' as portable data; this app cannot safely display its schema/content.');
        if(snapshot.records.some(item=>!item.opaque&&item.type===r.type&&String(item.localId)===String(snapshot.state.imports?.[k]?.localId)))warnings.push('The previous readable copy was kept separately from the newer portable record.');
      } else {
        delete state.opaque[k];
        const existing=snapshot.records.find(item=>!item.opaque&&item.type===r.type&&String(item.localId)===String(change.localId));
        let data=retainFields(existing?.data||{},r.data);data.id=change.localId;data.synced=false;data.updatedAt=Date.now();
        if(data.lng!=null&&data.lon==null)data.lon=data.lng;
        for(const link of r.links||[]) {
          const target=ids.get(key({type:link.type,origin:link.origin}));put(data,link.path,target??null);
          if(target==null)warnings.push('A linked '+link.type+' record was not included. Its original relation is preserved for re-export.');
        }
        data=await mapStrings(data,v=>{const id=ASSET.exec(v)?.[1];const a=id&&assets.get(id);return a?'data:'+a.mediaType+';base64,'+a.data:v;});
        if(change.type==='trackSessions')data.active=false;
        change.data=data;
      }
      const referenced=new Set();await mapStrings(r.data,v=>{const id=ASSET.exec(v)?.[1];if(id)referenced.add(id);return v;});
      state.imports[k]={type:r.type,localId:change.localId,fingerprint:change.fingerprint,wire:r,packageId:file.packageId,attachments:[...referenced].map(id=>clone(assets.get(id)))};
    }
    if(changes.some(c=>c.status!=='skip')) {
      const metadata=clone(file);delete metadata.records;delete metadata.attachments;
      if(!state.forwardedPackages.some(p=>p.packageId===metadata.packageId))state.forwardedPackages.push(metadata);
    }
    return {changes,state,revision:revision(snapshot),warnings:[...new Set(warnings)],counts:{add:changes.filter(c=>c.status==='add').length,update:changes.filter(c=>c.status==='update').length,skip:changes.filter(c=>c.status==='skip').length,preserved:changes.filter(c=>c.status!=='skip'&&!c.supported).length}};
  }
  return {FORMAT,MAX_BYTES,TYPES,RELATIONS,IMAGE,ASSET,clone,canonical,uuid,hash,digestSync,key,localKey,guard,mapStrings,revision,pack,parse,plan,safeToDisplay};
});
