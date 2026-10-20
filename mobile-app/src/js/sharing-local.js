/* IndexedDB adapter. Import writes and sharing identities commit in one transaction. */
const SharingLocal = (()=>{
  const S=FieldShare;
  const STORES=['waypoints','routes','specimens','digOrders','orders','trackSessions','measurements'];
  const ALL=[...STORES,'sharing','settings','track','ai-cache','photos'];
  const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  async function initialize(){
    await openWpDB();
    return new Promise((resolve,reject)=>{
      const tx=wpDB.transaction('sharing','readwrite'),store=tx.objectStore('sharing');let state;
      const r=store.get('state');r.onsuccess=()=>{state=r.result?.value;if(!state){state={source:S.uuid(),imports:{},opaque:{},forwardedPackages:[]};store.put({id:'state',value:state});}};
      tx.oncomplete=()=>resolve(state);tx.onabort=tx.onerror=()=>reject(tx.error||Error('Cannot open sharing metadata.'));
    });
  }
  function decode(raw,native=[]) {
    const state=raw.sharing.find(r=>r.id==='state').value,records=[];
    for(const type of STORES)for(const data of raw[type])records.push({type,localId:data.id,data});
    const settings=new Map(raw.settings.keys.map((key,i)=>[key,raw.settings.values[i]]));
    if(raw.track.length)records.push({type:'trackLog',localId:'live-trail',data:{id:'live-trail',name:'Recorded map trail',points:raw.track}});
    for(const [name,type]of [['route-draft','routeDraft'],['trip-data','tripData'],['recording-session','recordingDraft']])if(settings.get(name))records.push({type,localId:name,data:{id:name,name,...settings.get(name)}});
    for(const [i,key]of raw['ai-cache'].keys.entries())records.push({type:'aiResults',localId:key,data:{id:key,waypointId:key,...raw['ai-cache'].values[i]}});
    const preferences={};for(const key of ['geofence-enabled','geofence-radius'])if(settings.has(key))preferences[key]=settings.get(key);
    if(Object.keys(preferences).length)records.push({type:'preferences',localId:'portable-preferences',data:{id:'portable-preferences',name:'Portable preferences',values:preferences}});
    for(const session of native)records.push({type:'trackSessions',localId:'native:'+session.id,data:{...session,nativeSessionId:session.id},native:true});
    for(const [id,opaque]of Object.entries(state.opaque||{}))records.push({type:opaque.record.type,localId:'opaque:'+id,data:opaque.record.data,opaque});
    const snapshot={source:state.source,state,records,mediaRevision:raw.photos};snapshot.revision=S.revision(snapshot);return snapshot;
  }
  function readTransaction(tx) {
    const tasks={};
    for(const name of STORES)tasks[name]=request(tx.objectStore(name).getAll());
    tasks.sharing=request(tx.objectStore('sharing').getAll());tasks.track=request(tx.objectStore('track').getAll());tasks.photos=request(tx.objectStore('photos').getAllKeys());
    for(const name of ['settings','ai-cache']){const store=tx.objectStore(name);tasks[name]=Promise.all([request(store.getAllKeys()),request(store.getAll())]).then(([keys,values])=>({keys,values}));}
    return Promise.all(Object.entries(tasks).map(async([k,p])=>[k,await p])).then(entries=>Object.fromEntries(entries));
  }
  async function snapshot(){
    await initialize();
    const raw=await readTransaction(wpDB.transaction(ALL,'readonly'));
    const native=typeof NativeGps!=='undefined'&&NativeGps.isNative?await NativeGps.getSessions():[];
    return decode(raw,native);
  }
  async function photosFor(id){await openWpDB();return request(wpDB.transaction('photos').objectStore('photos').index('waypointId').getAll(id));}
  async function image(ref){
    if(S.IMAGE.test(ref))return ref;
    const value=await request(wpDB.transaction('photos').objectStore('photos').get(ref));
    return value?.dataUrl||null; // Never fetch somebody else's URL, even if the device is online.
  }
  async function exportPackage(selected,options){
    if((typeof NativeGps!=='undefined'&&NativeGps.isTracking)||(typeof recordingTrack!=='undefined'&&recordingTrack))throw Error('Stop recording before exporting a consistent snapshot.');
    const value=await snapshot();
    return S.pack(value,selected,{...options,resolvePhoto:image,prepareData:async(item,data)=>{
      if(item.native)data.points=await NativeGps.getSessionPoints(item.data.id);
      if(item.type==='waypoints'){
        const photos=await photosFor(item.localId);
        if(photos.length)data.photos=photos.sort((a,b)=>(a.index||0)-(b.index||0)).map(p=>p.dataUrl);
      }
      return data;
    }});
  }
  async function preview(input,options={}){
    const file=await S.parse(input),value=await snapshot(),plan=await S.plan(file,value,{...options,supported:STORES});
    plan.photoBaseline={};
    for(const change of plan.changes)if(change.type==='waypoints'&&change.status==='update'&&change.supported)plan.photoBaseline[String(change.localId)]=await photosFor(change.localId);
    return {file,plan};
  }
  async function apply(previewed){
    const {plan}=previewed;
    await openWpDB();
    return new Promise((resolve,reject)=>{
      const tx=wpDB.transaction(ALL,'readwrite');let error;
      tx.oncomplete=()=>resolve(plan.counts);tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('Import transaction aborted; no records were changed.'));
      const baseline=new Map(Object.entries(plan.photoBaseline||{}).map(([id,images])=>[id,images]));
      const reads=readTransaction(tx),photoReads=[];
      for(const [id]of baseline){const change=plan.changes.find(c=>String(c.localId)===id);photoReads.push(request(tx.objectStore('photos').index('waypointId').getAll(change.localId)).then(images=>[id,images]));}
      Promise.all([reads,Promise.all(photoReads)]).then(([raw,images])=>{
        try{
          if(S.revision(decode(raw))!==plan.revision)throw Error('Local data changed. Preview the file again before importing.');
          for(const [id,current]of images)if(S.canonical(current)!==S.canonical(baseline.get(id)))throw Error('Local photos changed. Preview the file again.');
          for(const change of plan.changes)if(change.status!=='skip'&&change.supported){
            const data=S.clone(change.data);
            if(change.type==='waypoints'&&Object.hasOwn(change.wire.data,'photos')){
              for(const old of baseline.get(String(change.localId))||[])tx.objectStore('photos').delete(old.id);
              const photos=Array.isArray(data.photos)?data.photos:[];
              data.photos=[];data.photoCount=photos.length;
              photos.forEach((dataUrl,index)=>tx.objectStore('photos').put({id:`${data.id}-${index}`,waypointId:data.id,index,dataUrl}));
            }
            tx.objectStore(change.type).put(data);
          }
          if(plan.changes.some(c=>c.status!=='skip'))tx.objectStore('sharing').put({id:'state',value:plan.state});
        }catch(e){error=e;tx.abort();}
      }).catch(e=>{error=e;try{tx.abort();}catch{}});
    });
  }
  return {snapshot,exportPackage,preview,apply};
})();
