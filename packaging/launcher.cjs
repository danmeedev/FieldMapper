const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function getDataHome(env = process.env) {
  return env.FIELDMAPPER_HOME || path.join(env.LOCALAPPDATA || os.homedir(), 'Field Mapper');
}

async function main() {
  const root = __dirname;
  const port = Number(process.env.FIELDMAPPER_PORT || 3000);
  const url = `http://localhost:${port}`;
  const home = getDataHome();
  const logs = path.join(home, 'logs'); fs.mkdirSync(logs, { recursive: true });
  const logPath = path.join(logs, `startup-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  const print = text => { process.stdout.write(text + '\n'); log.write(new Date().toISOString() + ' ' + text + '\n'); };
  const openBrowser = () => {
    if (process.env.FIELDMAPPER_NO_BROWSER === '1') return;
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached:true, stdio:'ignore', windowsHide:true });
    browser.on('error', () => print(`Open your browser and enter ${url}`)); browser.unref();
  };
  async function status() {
    try { const r = await fetch(url + '/api/status', { signal:AbortSignal.timeout(1000) }); return r.ok ? await r.json() : null; }
    catch { return null; }
  }
  const existing = await status();
  if (existing?.server === 'Field Mapper Laptop Server') {
    print(`Field Mapper is already running. Opening ${url}`);openBrowser();log.end();return;
  }
  if (existing) throw new Error(`Another application is using port ${port}. Close it and try again.`);
  const app = path.join(root,'app','server.js');
  if (!fs.existsSync(app)) throw new Error('App files are missing. Extract the entire ZIP before starting.');
  print('FIELD MAPPER — keep this window open while you use the app.');
  print(`Your maps, field records and settings are saved in: ${home}`);
  print(`Startup log: ${logPath}`);
  const child = spawn(process.execPath, [app], {
    cwd:path.dirname(app), windowsHide:true,
    env:{...process.env,FIELDMAPPER_PORT:String(port),FIELDMAPPER_HTTPS:'0',
      FIELDMAPPER_DATA_DIR:path.join(home,'data'),FIELDMAPPER_TILES_DIR:path.join(home,'tiles'),FIELDMAPPER_CONFIG_FILE:path.join(home,'config.json')},
    stdio:['inherit','pipe','pipe']
  });
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{process.stdout.write(chunk);log.write(chunk)});
  let stopped=false;
  child.on('error',e=>print(`Could not start: ${e.message}`));
  child.on('exit',code=>{stopped=true;log.end();process.exitCode=code || 0;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill();log.end();});
  let ready;
  for(let i=0;i<100 && !stopped;i++){
    ready=await status();if(ready?.server==='Field Mapper Laptop Server')break;
    await new Promise(r=>setTimeout(r,200));
  }
  if(!ready || stopped){child.kill();throw new Error(`Startup failed. Read the log at ${logPath}. If port ${port} is busy, close the other app.`);}
  print(`\nPC browser: ${url}`);
  print('On your Android phone: Map > menu > Settings > Laptop Server URL.');
  for(const entry of ready.connectionUrls || [])print(`  ${entry.interface}: ${entry.url}`);
  print('Use the Wi-Fi/hotspot address. The PC Settings screen also lists these addresses.');
  print('If Windows asks about network access, allow Field Mapper on your trusted private network.');
  print('Press Ctrl+C or close this window to stop the PC app.');
  openBrowser();
}
if(require.main===module)main().catch(e=>{console.error('\nField Mapper could not start: '+e.message);process.exitCode=1;});

module.exports = { getDataHome };
