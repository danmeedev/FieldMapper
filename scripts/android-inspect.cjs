const { WebSocket } = require('ws');
const fs = require('fs');
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
  const target = targets.find(t => t.url.startsWith('https://localhost'));
  if (!target) throw new Error('Field Mapper WebView not found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  let id=0;const pending=new Map();
  ws.on('message',raw=>{const r=JSON.parse(raw);if(pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const expression=process.argv[2] || `(async()=>{await saveSetting('laptopUrl','http://10.0.2.2:3000');await initGpsView();await AiSettings.refresh();return {native:NativeGps.isNative,tracking:NativeGps.isTracking,url:await getSetting('laptopUrl'),ai:AiSettings.ready,top:getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),bodyTop:document.body.getBoundingClientRect().top,title:document.title}})()`;
  try {
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    console.log(JSON.stringify(result.result.value));
    if(!process.argv[2]) {const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.review-logs/android-webview.png',Buffer.from(screenshot.data,'base64'));}
  } finally {ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
