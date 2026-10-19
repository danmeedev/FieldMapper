const fs = require('fs');
const path = require('path');
(async()=>{
  const {marked}=await import('marked');
  const destination=process.argv[2];
  for(const name of ['README','QUICK-SETUP']){
    const markdown=fs.readFileSync(path.join(__dirname,'..',name+'.md'),'utf8');
    const body=marked.parse(markdown).replace(/<h([1-6])>(.*?)<\/h\1>/g, (_,depth,title) => {
      const id=title.replace(/<[^>]+>/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
      return `<h${depth} id="${id}">${title}</h${depth}>`;
    }).replace(/href="(README|QUICK-SETUP)\.md(#[^"]*)?"/g,(_,n,a)=>`href="${n}.html${a||''}"`);
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field Mapper — ${name==='README'?'Reference':'Quick Setup'}</title><style>
      body{font:17px/1.65 system-ui,sans-serif;color:#233037;background:#f2f5f4;margin:0}main{max-width:980px;margin:32px auto;background:white;padding:36px;border-radius:12px}h1,h2,h3{line-height:1.25;color:#174c3d}h2{margin-top:2em;border-bottom:1px solid #dce6e1;padding-bottom:10px}a{color:#146b9b}table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:10px;border:1px solid #dce6e1;text-align:left;vertical-align:top}th{background:#edf5f0}code{background:#edf1f4;padding:2px 5px;border-radius:3px}pre{overflow:auto;background:#edf1f4;padding:16px}blockquote{border-left:4px solid #30866a;padding-left:16px;margin-left:0}li{margin:7px 0}@media(max-width:700px){main{margin:0;padding:20px;border-radius:0}table{display:block;overflow-x:auto}}
      </style></head><body><main>${body}</main></body></html>`;
    fs.writeFileSync(path.join(destination,name+'.html'),html);
  }
  fs.copyFileSync(path.join(destination,'QUICK-SETUP.html'),path.join(destination,'START HERE.html'));
})().catch(e=>{console.error(e);process.exitCode=1});
