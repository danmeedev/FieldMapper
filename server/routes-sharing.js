const {createStore}=require('./sharing-store');
const Share=require('../public/js/share-format');
module.exports=function setupSharing(app,dataDir){
  const store=createStore(dataDir);
  app.use('/api/sharing',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    let sameOrigin=true;
    if(req.get('origin'))try{const u=new URL(req.get('origin'));sameOrigin=['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&Number(u.port||(u.protocol==='https:'?443:80))===req.socket.localPort;}catch{sameOrigin=false;}
    if(!loopback||!sameOrigin)return res.status(403).json({error:'Open Sharing on this PC at localhost. Android shares its own local data.'});
    next();
  });
  const handler=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(400).json({error:e.message});}};
  app.get('/api/sharing/catalog',handler(()=>store.snapshot().records.map(r=>({key:Share.localKey(r.type,r.localId),type:r.type,label:r.data.name||r.data.title||r.data.client||String(r.localId),preserved:!!r.opaque}))));
  app.post('/api/sharing/export',handler(req=>store.exportPackage(req.body.selected,req.body.options)));
  app.post('/api/sharing/preview',handler(async req=>{const {plan}=await store.preview(req.body.package,req.body.options);return {revision:plan.revision,counts:plan.counts,warnings:plan.warnings,changes:plan.changes.map(({key,type,status,label,supported})=>({key,type,status,label,preserved:supported===false}))};}));
  app.post('/api/sharing/import',handler(req=>store.apply(req.body.package,req.body.options)));
};
