/* User-initiated local files only. No external sharing service, discovery, or telemetry. */
(function(){
  'use strict';
  const S=FieldShare, mobile=typeof SharingLocal!=='undefined';
  const labels={waypoints:'Points',routes:'Routes',specimens:'Specimens',digOrders:'Dig orders',orders:'Orders',trackSessions:'GPS recordings',measurements:'Measurements',trackLog:'Map trail',aiResults:'Saved analysis',preferences:'Portable preferences',routeDraft:'Route draft',tripData:'Trip data',recordingDraft:'Recording draft'};
  let dialog,catalog=[],outgoing=null,incoming=null,previewed=null,busy=false,generation=0;
  const exportSelection=new Set(),importSelection=new Set();
  const native=()=>globalThis.Capacitor?.isNativePlatform?.();
  const files=()=>globalThis.Capacitor?.isPluginAvailable?.('SharingFiles')?globalThis.Capacitor.Plugins.SharingFiles:null;
  async function api(path,body){const r=await fetch('/api/sharing/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||'Local sharing request failed.');return result;}
  function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!=null)node.textContent=text;Object.assign(node,attrs);return node;}
  function status(text){dialog.querySelector('#sharing-status').textContent=text;}
  function button(text,action){const b=el('button',text,{type:'button'});b.onclick=action;return b;}
  function ensure(){
    if(dialog)return;
    dialog=el('dialog',null,{id:'sharing-dialog'});dialog.setAttribute('aria-labelledby','sharing-title');
    dialog.style.cssText='margin:auto;width:94%;max-width:780px;max-height:90vh;overflow:auto;padding:20px;border:1px solid #666;border-radius:10px;background:#222;color:white;line-height:1.5';
    const style=el('style');style.textContent='#sharing-dialog button,#sharing-dialog select,#sharing-dialog input[type=search]{padding:8px;margin:4px;border:1px solid #777;border-radius:4px;background:#333;color:white} #sharing-dialog label{display:block;margin:6px 0} #sharing-dialog .sharing-list{max-height:240px;overflow:auto;border:1px solid #555;padding:8px} #sharing-dialog summary{cursor:pointer;font-weight:bold} #sharing-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto}';dialog.append(style);
    dialog.append(el('h2','Share data',{id:'sharing-title'}),el('p','Choose a point, route, several records, or all field data. Save a file and give it to another user by USB, Bluetooth, Nearby Share, or any method you choose. No sharing account or internet is required.'));
    dialog.append(el('p','Files can contain precise locations, photos, notes, customer details, and custom fields. Review your selection before sending. API keys, laptop addresses, deletion history, and cached map tiles are not included.'));
    const out=el('section');out.append(el('h3','Send data'));
    const search=el('input',null,{id:'sharing-search',type:'search',placeholder:'Filter by name or type'});search.oninput=renderExport;out.append(search);
    out.append(button('Select all field data',()=>{catalog.filter(r=>r.type!=='preferences').forEach(r=>exportSelection.add(r.key));renderExport();}),button('Clear selection',()=>{exportSelection.clear();renderExport();}));
    const list=el('div',null,{id:'sharing-export-list',className:'sharing-list'});out.append(list);
    for(const [id,text,checked]of [['sharing-photos','Include locally available photos',true],['sharing-related','Also include linked records (may include business/customer data)',false],['sharing-metadata','Include original file notes/metadata (may describe other records)',false]]){
      const l=el('label'),cb=el('input',null,{id,type:'checkbox',checked});l.append(cb,document.createTextNode(' '+text));out.append(l);
    }
    out.append(el('p','Portable preferences can be selected separately. Imports retain them for viewing/re-export and never replace the recipient’s device settings.'));
    out.append(button('Create sharing file',()=>run(createExport)),el('p','',{id:'sharing-export-count'}));
    const save=button('Save file',()=>run(()=>saveOutgoing(false)));save.id='sharing-save';save.hidden=true;
    const share=button('Share file…',()=>run(()=>saveOutgoing(true)));share.id='sharing-send';share.hidden=true;out.append(save,share);
    dialog.append(out,el('hr'));
    const intake=el('section');intake.append(el('h3','Receive data'));
    const input=el('input',null,{id:'sharing-file',type:'file',accept:'.json,application/json'});input.hidden=true;
    input.onchange=()=>run(async()=>{const file=input.files[0];if(file){if(file.size>S.MAX_BYTES)throw Error('Sharing files are limited to 32 MiB.');await loadIncoming(await file.text());}input.value='';});
    intake.append(input,button('Open sharing file…',()=>{
      if(!files()){if(!busy)input.click();return;}
      run(async()=>{const result=await files().pickFile();if(!result.cancelled)await loadIncoming(result.content);});
    }));
    const mode=el('select',null,{id:'sharing-conflict'});mode.append(el('option','Keep existing shared copies',{value:'skip'}),el('option','Replace previously imported copies',{value:'update'}));mode.onchange=()=>run(refreshPreview);intake.append(mode);
    intake.append(button('Select all incoming',()=>run(async()=>{incoming?.records.forEach(r=>importSelection.add(S.key(r)));await refreshPreview();})),button('Clear incoming selection',()=>run(async()=>{importSelection.clear();await refreshPreview();})));
    intake.append(el('div',null,{id:'sharing-import-list',className:'sharing-list'}),el('p','',{id:'sharing-preview-summary'}));
    const apply=button('Import selected records',()=>run(applyImport));apply.id='sharing-apply';apply.disabled=true;intake.append(apply);dialog.append(intake);
    const detail=el('details');detail.append(el('summary','Preview selected record data'),el('pre','Select a record’s Details button to inspect all its fields.',{id:'sharing-details'}));dialog.append(detail);
    dialog.append(el('p','',{id:'sharing-status',role:'status'}));
    const controls=el('fieldset',null,{id:'sharing-controls'});controls.style.cssText='border:0;padding:0;min-width:0';
    while(dialog.firstChild)controls.append(dialog.firstChild);
    dialog.append(controls,button('Close',()=>dialog.close()));
    document.body.append(dialog);
  }
  async function run(task){if(busy)return;busy=true;dialog.querySelector('#sharing-controls').disabled=true;dialog.setAttribute('aria-busy','true');try{await task();}catch(e){status(e.message);}finally{busy=false;dialog.querySelector('#sharing-controls').disabled=false;dialog.removeAttribute('aria-busy');}}
  function details(data){dialog.querySelector('#sharing-details').textContent=JSON.stringify(data,null,2);dialog.querySelector('details').open=true;}
  function renderExport(){
    const list=dialog.querySelector('#sharing-export-list');list.replaceChildren();const query=dialog.querySelector('#sharing-search').value.toLowerCase();
    const visible=catalog.filter(r=>(labels[r.type]||r.type).toLowerCase().includes(query)||String(r.label).toLowerCase().includes(query));
    for(const r of visible.slice(0,1000)){
      const row=el('label'),cb=el('input',null,{type:'checkbox',checked:exportSelection.has(r.key)});
      cb.onchange=()=>{if(cb.checked)exportSelection.add(r.key);else exportSelection.delete(r.key);updateExportCount();};
      row.append(cb,document.createTextNode(' '+(labels[r.type]||r.type)+' — '+String(r.label).slice(0,200)+(r.preserved?' (preserved data)':'')));list.append(row);
    }
    if(visible.length>1000)list.append(el('p','Showing the first 1,000 matches. Filter to select individual records; Select all still selects the entire collection.'));
    if(!visible.length)list.append(el('p','No matching records.'));updateExportCount();
  }
  function updateExportCount(){outgoing=null;dialog.querySelector('#sharing-save').hidden=true;dialog.querySelector('#sharing-send').hidden=true;dialog.querySelector('#sharing-export-count').textContent=exportSelection.size+' selected';}
  async function loadCatalog(){
    if(mobile){const value=await SharingLocal.snapshot();catalog=value.records.map(r=>({key:S.localKey(r.type,r.localId),type:r.type,label:r.data.name||r.data.title||r.data.client||String(r.localId),preserved:!!r.opaque,data:r.data}));}
    else catalog=await api('catalog');
    const available=new Set(catalog.map(r=>r.key));for(const key of exportSelection)if(!available.has(key))exportSelection.delete(key);renderExport();
  }
  async function createExport(){
    if(!exportSelection.size)throw Error('Select at least one record.');
    const options={includePhotos:dialog.querySelector('#sharing-photos').checked,includeLinked:dialog.querySelector('#sharing-related').checked,includePackageMetadata:dialog.querySelector('#sharing-metadata').checked};
    status('Creating an offline file…');const result=mobile?await SharingLocal.exportPackage([...exportSelection],options):await api('export',{selected:[...exportSelection],options});
    outgoing=JSON.stringify(result.package);
    dialog.querySelector('#sharing-save').hidden=false;dialog.querySelector('#sharing-send').hidden=!files()&&!navigator.share;
    details({records:result.package.records,attachments:result.package.attachments.map(({id,mediaType,bytes})=>({id,mediaType,bytes})),extensions:result.package.extensions});
    status('Ready: '+result.package.records.length+' records, '+result.package.attachments.length+' photos. '+result.warnings.join(' '));
  }
  async function saveOutgoing(share){
    if(!outgoing)throw Error('Create a sharing file first.');
    const filename='FieldMapper-'+new Date().toISOString().replace(/[:.]/g,'-')+'.fieldmapper.json';
    if(files()){const result=await files()[share?'shareFile':'saveFile']({filename,content:outgoing});status(result.cancelled?'Cancelled.':'File handed to Android. Choose your own recipient or storage location.');return;}
    if(native())throw Error('This development APK needs the SharingFiles plugin. Rebuild the Android development app before saving/sharing files.');
    const blob=new Blob([outgoing],{type:'application/json'});
    if(share){const file=new File([blob],filename,{type:'application/json'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Field Mapper data'});return;}throw Error('File sharing is unavailable here. Save the file and transfer it using your preferred method.');}
    const url=URL.createObjectURL(blob),a=el('a',null,{href:url,download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Sharing file saved.');
  }
  async function loadIncoming(text){
    incoming=null;previewed=null;dialog.querySelector('#sharing-apply').disabled=true;
    dialog.querySelector('#sharing-import-list').replaceChildren();status('Validating file and embedded photos…');
    const parsed=await S.parse(text);incoming=parsed;importSelection.clear();parsed.records.forEach(r=>importSelection.add(S.key(r)));await refreshPreview();
  }
  async function refreshPreview(){
    if(!incoming)return;const ticket=++generation;
    const options={selected:[...importSelection],update:dialog.querySelector('#sharing-conflict').value==='update'};
    const result=mobile?await SharingLocal.preview(incoming,options):await api('preview',{package:incoming,options});
    if(ticket!==generation)return;
    previewed=mobile?result:{plan:result};
    const plan=previewed.plan,list=dialog.querySelector('#sharing-import-list');list.replaceChildren();
    const changes=new Map(plan.changes.map(c=>[c.key,c]));
    for(const record of incoming.records.slice(0,1000)){
      const key=S.key(record),change=changes.get(key),row=el('div'),label=el('label'),cb=el('input',null,{type:'checkbox',checked:importSelection.has(key)});
      cb.onchange=()=>run(async()=>{if(cb.checked)importSelection.add(key);else importSelection.delete(key);await refreshPreview();});
      label.append(cb,document.createTextNode(' '+(labels[record.type]||record.type)+' — '+String(record.data.name||record.data.title||record.origin.id).slice(0,200)+' ['+(change?.status||'not selected')+']'));row.append(label,button('Details',()=>details(record.data)));list.append(row);
    }
    if(incoming.records.length>1000)list.append(el('p','Showing the first 1,000 records. Incoming Select all/Clear apply to the whole file.'));
    dialog.querySelector('#sharing-preview-summary').textContent=`${plan.counts.add} new, ${plan.counts.update} replacements, ${plan.counts.skip} skipped; ${plan.counts.preserved} retained as portable data. `+plan.warnings.join(' ');
    dialog.querySelector('#sharing-apply').disabled=plan.counts.add+plan.counts.update===0;
    status('Preview only. Nothing has been imported.');
  }
  async function applyImport(){
    if(!previewed)return;const counts=previewed.plan.counts;
    if(!confirm(`Import ${counts.add} new records and replace ${counts.update} previously imported copies?\n\nYour other records and deletions will not be changed. Replacements can overwrite edits to those imported copies.`))return;
    const result=mobile?await SharingLocal.apply(previewed):await api('import',{package:incoming,options:{selected:[...importSelection],update:dialog.querySelector('#sharing-conflict').value==='update',revision:previewed.plan.revision}});
    previewed=null;dialog.querySelector('#sharing-apply').disabled=true;
    await loadCatalog();
    status(`Imported ${result.add} new and ${result.update} updated records. ${result.skip} skipped. Close and refresh the app's record panels to view them.`);
  }
  globalThis.DataSharing={async open(){ensure();if(!dialog.open)dialog.showModal();await run(async()=>{status('Reading local data…');await loadCatalog();status('Select what you want to share, or open a file to preview an import.');});}};
})();
