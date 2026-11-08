import { decode, editMii, fields, randomChanges } from './mii.js';
const $ = id => document.getElementById(id);
const pages={editor:['Mii editor_','Edit the loaded player Mii.'],qr:['Import QR','Import a Mii QR image or MiiCharacters link.'],ocw:['OCW upload','Upload the current Mii to OpenCourse World.'],data:['Inspect data','Inspect or export the loaded Mii data.']};
function setPage(page) {
  if(!pages[page])page='editor';
  document.querySelectorAll('.app-page').forEach(panel=>panel.hidden=panel.id!==`view-${page}`);
  document.querySelectorAll('[data-page]').forEach(button=>{if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('page-title').textContent=pages[page][0];
  $('page-description').textContent=pages[page][1];
  document.title=page==='editor' ? 'Mii editor_ · companion for smm2-dx' : `${pages[page][0]} · Mii editor_`;
  window.scrollTo(0,0);
}
document.querySelectorAll('[data-page],[data-go]').forEach(button=>button.addEventListener('click',()=>{const page=button.dataset.page || button.dataset.go;setPage(page);if(location.hash!==`#${page}`)location.hash=page;}));
window.addEventListener('hashchange',()=>setPage(location.hash.slice(1)));
setPage(location.hash.slice(1));
let current, baseline, view = 'face', renderController;
let verifying = false;
let qrUndo=null;
let uploadConfig=null, uploading=false, selectingConfig=false;
const favoriteColors = ['Red','Orange','Yellow','Lime','Green','Blue','Light blue','Pink','Purple','Brown','White','Black'];
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function show(data) {
  current = data;
  const m = data.maker;
  $('mii-name').textContent = data.name;
  $('username').textContent = m?.username || data.name;
  $('maker-id').textContent = m?.id || 'Imported Mii';
  $('initial').textContent = (m?.username || data.name).slice(0,1);
  $('provider').textContent = m?.login_provider?.toUpperCase() || 'IMPORT';
  $('stats').replaceChildren(...['plays','tries','clears','deaths','world_records','first_clears'].map(key => {
    const el = element('div','', 'stat'); el.append(element('b', Number.isFinite(m?.stats?.[key]) ? m.stats[key].toLocaleString() : 'N/A'), element('span', key.replaceAll('_',' ').replace(/^./, c => c.toUpperCase()))); return el;
  }));
  $('summary').replaceChildren(...[['Format','Switch CharInfo'],['Size','88 bytes'],['Gender',data.bytes[40] ? 'Female' : 'Male'],['Favorite color',favoriteColors[data.bytes[39]]],['Mii ID',m?.mii?.id ?? 'N/A']].flatMap(([k,v]) => [element('dt', k),element('dd',v)]));
  for (const [key,offset] of [['height',41],['build',42]]) { $(key).value = data.bytes[offset]; $(`${key}-value`).textContent = data.bytes[offset]; }
  $('fields').replaceChildren(...data.fields.map(f => { const el = element('div','', 'field'); const label = element('span',f.name); label.append(element('small',`0x${f.offset.toString(16)}`)); el.append(label,element('b',f.value)); return el; }));
  $('hex').textContent = Array.from({length:6}, (_,row) => { const offset = row*16; return `${offset.toString(16).padStart(4,'0')}    ${Array.from(data.bytes.slice(offset,offset+16),b=>b.toString(16).padStart(2,'0')).join(' ')}`; }).join('\n');
  $('source').value = m ? JSON.stringify(m,null,2) : data.base64;
  $('import-error').textContent = '';
  updateEditor();
  render();
}
const draftKey = data => `ocw-mii:draft:${data.maker?.id || data.hex.slice(0,32)}`;
function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey(baseline))); } catch { return null; } }
function loadData(data) {
  baseline = data;
  qrUndo=null; $('qr-undo').hidden=true;
  $('server-state').textContent = 'Not verified on OCW';
  $('sync-status').textContent = 'Choose your config to upload directly. The previous profile is backed up, then OCW’s public API is checked for an exact match.';
  const draft = readDraft();
  if (draft?.baseline === data.base64 && draft?.base64 !== data.base64) {
    try { const restored = decode(draft.base64); const maker = structuredClone(data.maker); if (maker?.mii) maker.mii.mii_data = restored.base64; show(maker?.mii ? decode(JSON.stringify(maker)) : restored); return; } catch { /* Keep malformed drafts from breaking loading. */ }
  }
  show(data);
}
function updateEditor() {
  $('edit-name').value = current.name;
  $('nickname-count').textContent = `${current.name.length} / 10`;
  $('edit-color').value = current.bytes[39]; $('edit-gender').value = current.bytes[40];
  for (const input of document.querySelectorAll('[data-field]')) input.value = current.bytes[Number(input.dataset.field)];
  const changes = current.fields.filter(f => f.value !== baseline.bytes[f.offset]).map(f => `${f.name}: ${baseline.bytes[f.offset]} → ${f.value}`);
  if (current.name !== baseline.name) changes.unshift(`Nickname: ${baseline.name} → ${current.name}`);
  $('draft-state').textContent = changes.length ? `${changes.length} changed field${changes.length === 1 ? '' : 's'} · local draft` : 'No changes from loaded data';
  $('change-list').replaceChildren(...changes.map(text => element('p',text)));
  $('revert').disabled = changes.length === 0;
  $('restore-draft').disabled = !readDraft();
  $('verify-server').disabled = !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(current.maker?.id || '') || verifying;
  $('upload-ocw').disabled = !uploadConfig?.available || current.maker?.id!==uploadConfig.makerCode || uploading;
  if(!$('ocw-config-maker').value && current.maker?.id) $('ocw-config-maker').value=current.maker.id;
  $('ocw-config-use').disabled=uploading || selectingConfig;
  $('ocw-config-clear').disabled=!uploadConfig?.configured || uploading || selectingConfig;
}
function applyEdit(changes) {
  try {
    const updated = editMii(current,changes);
    show(updated);
    $('server-state').textContent = 'Not verified on OCW';
    $('sync-status').textContent = 'Edited locally. Upload directly to OCW or export your Mii to a file.';
    try { localStorage.setItem(draftKey(baseline),JSON.stringify({baseline:baseline.base64,base64:current.base64,savedAt:Date.now()})); $('draft-state').textContent = current.base64 === baseline.base64 ? 'No changes from loaded data' : 'Draft saved in this browser'; $('restore-draft').disabled = false; }
    catch { $('draft-state').textContent = 'Draft could not be stored · export to keep changes'; }
    $('edit-error').textContent = '';
    return true;
  } catch (err) { $('edit-error').textContent = err.message; return false; }
}
$('edit-color').replaceChildren(...favoriteColors.map((text,index) => { const option = element('option',text); option.value = index; return option; }));
$('edit-fields').replaceChildren(...fields.filter(([,offset]) => offset >= 41 && ![43,44,87].includes(offset)).map(([name,offset,max]) => {
  const label = element('label',name); const input = document.createElement('input'); input.type='number'; input.min=name==='Eyebrow position' ? 3 : 0; input.max=max; input.step=1; input.dataset.field=offset;
  input.addEventListener('change',() => applyEdit({[name]:input.value === '' ? NaN : Number(input.value)})); label.append(input); return label;
}));
function commitNickname() {
  if(!current) return false;
  const name=$('edit-name').value;
  if(name===current.name) return true;
  const success=applyEdit({Nickname:name});
  $('nickname-status').textContent=success ? `Nickname “${current.name}” saved in your local draft.` : $('edit-error').textContent;
  $('nickname-status').classList.toggle('error',!success);
  return success;
}
$('edit-name').addEventListener('input',()=>{ $('nickname-count').textContent=`${$('edit-name').value.length} / 10`; $('nickname-status').textContent=''; });
$('edit-name').addEventListener('change',commitNickname);
$('nickname-form').addEventListener('submit',event=>{event.preventDefault();commitNickname();});
$('edit-color').addEventListener('change',() => applyEdit({'Favorite color':Number($('edit-color').value)}));
$('edit-gender').addEventListener('change',() => applyEdit({Gender:Number($('edit-gender').value)}));
document.querySelectorAll('[data-random]').forEach(button => button.addEventListener('click',() => { if(current) applyEdit(randomChanges(button.dataset.random)); }));
let qrBusy=false;
async function importQR(payload) {
  if(!current || qrBusy) return;
  const original=current.base64;
  const useName=$('qr-use-name').checked;
  qrBusy=true; $('qr-file').disabled=true; $('qr-url-import').disabled=true;
  $('qr-status').textContent='Reading and converting the Mii QR code…'; $('qr-status').className='';
  try {
    const response=await fetch('/api/qr-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,mii_data:original})});
    const result=await response.json(); if(!response.ok) throw new Error(result.error);
    if(current.base64!==original) throw new Error('Your Mii changed during import. Try importing the QR again into the current version.');
    const imported=decode(result.mii_data);
    const changes=Object.fromEntries(imported.fields.filter(f=>f.offset>=39 && ![43,44,87].includes(f.offset)).map(f=>[f.name,f.value]));
    if(useName && result.name?.trim()) changes.Nickname=result.name;
    const previous=current;
    if(!applyEdit(changes)) throw new Error($('edit-error').textContent);
    qrUndo=previous; $('qr-undo').hidden=false;
    $('qr-status').textContent=`Imported ${result.name || 'Mii'} from a ${result.format}. Appearance applied and saved as a local draft; your Mii identity and maker details are preserved.`;
  } catch(err) { $('qr-status').textContent=err.message; $('qr-status').className='error'; }
  finally { qrBusy=false; $('qr-file').disabled=false; $('qr-url-import').disabled=false; }
}
async function importQRFile(file) {
  if(!file || qrBusy) return;
  if(!['image/png','image/jpeg'].includes(file.type)) { $('qr-status').textContent='Use a PNG or JPEG QR image.'; return; }
  if(file.size>8*1024*1024) { $('qr-status').textContent='QR image is too large (maximum 8 MB).'; return; }
  try {
    const image=await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]); reader.onerror=()=>reject(new Error('Could not read this image.')); reader.readAsDataURL(file); });
    await importQR({image});
  } catch(err) { $('qr-status').textContent=err.message; }
}
$('qr-file').addEventListener('change',()=>{ const file=$('qr-file').files[0]; importQRFile(file); $('qr-file').value=''; });
$('qr-drop').addEventListener('paste',event=>{ const item=[...event.clipboardData.items].find(item=>item.type.startsWith('image/')); if(item) {event.preventDefault(); importQRFile(item.getAsFile());} else { $('qr-status').textContent='No image on the clipboard. Choose Copy image on the QR picture, or paste the page link below.'; } });
$('qr-drop').addEventListener('dragover',event=>{event.preventDefault();$('qr-drop').classList.add('dragging');});
$('qr-drop').addEventListener('dragleave',()=> $('qr-drop').classList.remove('dragging'));
$('qr-drop').addEventListener('drop',event=>{event.preventDefault();$('qr-drop').classList.remove('dragging');importQRFile(event.dataTransfer.files[0]);});
$('qr-drop').addEventListener('click',event=>{if(event.target===$('qr-drop') || event.target.parentElement===$('qr-drop')) $('qr-drop').focus();});
$('qr-url-form').addEventListener('submit',event=>{event.preventDefault();const url=$('qr-url').value.trim();if(url) importQR({url});});
$('qr-undo').addEventListener('click',()=>{
  if(!qrUndo || qrBusy) return;
  const changes=Object.fromEntries(qrUndo.fields.filter(f=>f.offset>=39 && ![43,44,87].includes(f.offset)).map(f=>[f.name,f.value]));
  changes.Nickname=qrUndo.name;
  if(applyEdit(changes)) {qrUndo=null;$('qr-undo').hidden=true;$('qr-status').textContent='Restored the Mii appearance from before the QR import.';}
});
$('revert').addEventListener('click',() => { show(baseline); try { localStorage.removeItem(draftKey(baseline)); } catch {} updateEditor(); $('edit-error').textContent=''; $('server-state').textContent='Not verified on OCW'; $('sync-status').textContent='Edits reverted to the loaded Mii. Exported files and OCW were not changed by reverting.'; });
$('restore-draft').addEventListener('click',() => { const draft=readDraft(); if (draft) { try { const data=decode(draft.base64); const maker=structuredClone(baseline.maker); if(maker?.mii) maker.mii.mii_data=data.base64; show(maker?.mii ? decode(JSON.stringify(maker)) : data); $('draft-state').textContent='Browser draft restored · compare against loaded data'; } catch(err) { $('edit-error').textContent=err.message; } } });
function download(blob,name) { const url=URL.createObjectURL(blob); const link=element('a',''); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('export-json').addEventListener('click',() => { if(current && commitNickname()) download(new Blob([JSON.stringify(current.maker || {mii_data:current.base64},null,2)],{type:'application/json'}),'edited-mii.json'); });
$('stage-game').addEventListener('click',async () => {
  if(!current || !commitNickname()) return;
  $('stage-game').disabled=true;
  try { const response=await fetch('/api/game-mii',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mii_data:current.base64})}); const result=await response.json(); if(!response.ok) throw new Error(result.error); $('sync-status').textContent=`Saved ${current.name} to the configured folder. This local export does not upload to OCW. ${result.backup ? 'Previous local Mii backed up.' : ''}`; }
  catch(err) { $('sync-status').textContent=err.message; }
  finally { $('stage-game').disabled=false; }
});
$('upload-ocw').addEventListener('click',async()=>{
  if(uploading || !current || !commitNickname() || !uploadConfig?.available) return;
  const sent=current.base64, id=current.maker?.id, name=current.name;
  uploading=true; updateEditor(); $('upload-ocw').textContent='Uploading & verifying…';
  $('server-state').textContent='Uploading to OCW';
  $('sync-status').textContent=`Backing up the current OCW profile and uploading ${name} through the authenticated game protocol…`;
  try {
    const response=await fetch('/api/ocw-upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maker_code:id,mii_data:sent})});
    const result=await response.json();if(!response.ok) throw new Error(result.error || 'OCW upload failed.');
    const changed=current.base64!==sent || current.maker?.id!==id;
    if(result.verified) {
      $('server-state').textContent=changed ? 'Earlier draft uploaded' : 'Upload verified on OCW';
      $('sync-status').textContent=`Verified at ${new Date(result.verifiedAt).toLocaleTimeString()}: OCW returns all 88 bytes of the uploaded Mii. ${result.unchanged ? 'The server already had the same Mii.' : `${name} was saved directly to OCW.`} ${changed ? 'Your current draft has changed since this upload; it has not been uploaded.' : ''} Previous profile backed up locally.`;
    } else {
      $('server-state').textContent='Submitted · not verified';$('sync-status').textContent=result.message;
    }
  } catch(error) { $('server-state').textContent='Upload not verified';$('sync-status').textContent=`${error.message} Use Check OCW persistence before retrying.`; }
  finally {uploading=false;$('upload-ocw').textContent='Upload directly to OCW';updateEditor();}
});
function showUploadConfig(info) {
  uploadConfig=info;
  $('upload-info').textContent=info.available ? `Using ${info.configName} for maker ${info.makerCode}. Direct upload backs up the previous profile and verifies the public API afterward. No game window is required.` : info.message;
  if(current) updateEditor();
}
$('ocw-config-form').addEventListener('submit',async event=>{
  event.preventDefault();if(uploading || selectingConfig)return;
  const file=$('ocw-config-file').files[0];if(!file)return;
  if(file.size>4096){$('config-status').textContent='The OCW config must be at most 4 KB.';return;}
  selectingConfig=true;if(current)updateEditor();$('config-status').textContent='Reading your selected OCW config…';
  try {
    const response=await fetch('/api/ocw-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:await file.text(),name:file.name,maker_code:$('ocw-config-maker').value.trim()})});
    const result=await response.json();if(!response.ok)throw new Error(result.error || 'Could not select this config.');
    showUploadConfig(result);$('ocw-config-file').value='';
    $('config-status').textContent=`${result.configName} selected for ${result.makerCode}. Config format validated; authentication is checked when you upload.`;
    $('server-state').textContent='Not verified on OCW';
  } catch(error){$('config-status').textContent=error.message;}
  finally{selectingConfig=false;if(current)updateEditor();}
});
$('ocw-config-clear').addEventListener('click',async()=>{
  if(uploading || selectingConfig)return;
  selectingConfig=true;if(current)updateEditor();
  try {
    const response=await fetch('/api/ocw-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'clear'})});
    const result=await response.json();if(!response.ok)throw new Error(result.error || 'Could not forget the config.');
    showUploadConfig(result);$('ocw-config-file').value='';$('config-status').textContent='Config forgotten. Choose a file to enable direct upload again.';
  }catch(error){$('config-status').textContent=error.message;}
  finally{selectingConfig=false;if(current)updateEditor();}
});
fetch('/api/ocw-upload').then(response=>response.json()).then(showUploadConfig).catch(()=>{$('upload-info').textContent='Direct-upload service is unavailable. Restart the local server.';});
$('verify-server').addEventListener('click',async () => {
  if(!current?.maker?.id || verifying) return;
  const expected=current.base64, id=current.maker.id;
  verifying=true; updateEditor(); $('sync-status').textContent='Reading the current Mii from OCW…';
  try {
    const response=await fetch(`/api/maker?id=${encodeURIComponent(id)}`); const result=await response.json(); if(!response.ok) throw new Error(result.error);
    const actual=decode(JSON.stringify(result));
    if(current.base64 !== expected || current.maker?.id !== id) { $('sync-status').textContent='The draft changed during the check. Check again for the current version.'; return; }
    if(actual.base64===expected) { $('server-state').textContent='Bytes match OCW'; $('sync-status').textContent=`Verified at ${new Date().toLocaleTimeString()}: OCW returns the same 88 bytes as this Mii. ${expected === baseline.base64 ? 'This matches the loaded original; no edited upload has been demonstrated.' : 'Your edited Mii is visible through the public API.'}`; }
    else { $('server-state').textContent='OCW differs from this draft'; const differences=actual.fields.filter(f=>f.value !== current.bytes[f.offset]).map(f=>f.name); if(actual.name!==current.name) differences.unshift('Nickname'); $('sync-status').textContent=`OCW still returns a different Mii (${differences.join(', ') || 'identity or reserved bytes differ'}). The edit has not been verified on the server. Upload this draft, or update the Mii in SMM2, then check again.`; }
  } catch(err) { $('server-state').textContent='Check failed'; $('sync-status').textContent=err.message; }
  finally { verifying=false; updateEditor(); }
});
fetch('/api/game-mii').then(response=>response.json()).then(info=> { $('bridge-info').textContent=info.available ? `Export destination: ${info.path}. The receiving software must support this format.` : 'Set OCW_GAME_DATA_ROOT to an existing folder before starting the editor to enable local file export.'; $('stage-game').disabled=!info.available; }).catch(()=>{ $('bridge-info').textContent='Local file export unavailable.'; $('stage-game').disabled=true; });
async function render() {
  if (!current) return;
  renderController?.abort(); const controller = new AbortController(); renderController = controller;
  $('render-status').textContent = 'Rendering your Mii…';
  $('mii-image').hidden = true;
  $('view-label').textContent = view === 'face' ? '01 / PORTRAIT' : '02 / FULL BODY';
  const params = new URLSearchParams({data: current.hex, type: view, expression: $('expression').value, rotate: $('rotation').value});
  try {
    const response = await fetch(`/api/render?${params}`,{signal:controller.signal});
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob();
    if (controller.signal.aborted) return;
    const img = $('mii-image'); const old = img.dataset.objectUrl; const next = URL.createObjectURL(blob);
    img.onload = () => { if (old) URL.revokeObjectURL(old); if (!controller.signal.aborted) { img.hidden = false; $('render-status').textContent = ''; } };
    img.onerror = () => { $('render-status').textContent = 'Could not display the rendered image. Try Reset.'; URL.revokeObjectURL(next); };
    img.alt = `${current.name}, ${view === 'face' ? 'portrait' : 'full body'} Mii render`;
    img.dataset.objectUrl = next; img.src = next;
  } catch (err) { if (err.name !== 'AbortError') $('render-status').textContent = err.message || 'Render failed. Try again.'; }
}
async function loadMaker(code) {
  $('load').disabled = true; $('notice').className = ''; $('notice').textContent = 'Fetching maker from OpenCourse World…';
  try {
    if (code.startsWith('http')) { const url = new URL(code); if (url.hostname !== 'server.opencourse.world') throw new Error('Use an OpenCourse World maker API URL.'); code = url.pathname.split('/').filter(Boolean).pop(); }
    const response = await fetch(`/api/maker?id=${encodeURIComponent(code.trim())}`);
    const json = await response.json(); if (!response.ok) throw new Error(json.error);
    loadData(decode(JSON.stringify(json))); $('notice').textContent = 'Live maker data loaded · local drafts restored when based on the same version';
  } catch (err) { $('notice').className = 'error'; $('notice').textContent = err.message; }
  finally { $('load').disabled = false; }
}
$('lookup').addEventListener('submit',event => { event.preventDefault(); loadMaker($('maker-code').value); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => {
  view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('selected',el === button); el.setAttribute('aria-pressed',String(el === button)); }); render();
}));
$('expression').addEventListener('change',render);
$('rotation').addEventListener('input',() => { $('degrees').textContent = `${$('rotation').value}°`; });
$('rotation').addEventListener('change',render);
$('reset').addEventListener('click',() => { $('rotation').value = 0; $('degrees').textContent = '0°'; $('expression').value = '0'; render(); });
const tabs = [...document.querySelectorAll('[data-tab]')];
function selectTab(button) { tabs.forEach(el => { const active = el === button; el.setAttribute('aria-selected',String(active)); el.tabIndex = active ? 0 : -1; $(`panel-${el.dataset.tab}`).hidden = !active; }); }
tabs.forEach((button,index) => { button.addEventListener('click',() => selectTab(button)); button.addEventListener('keydown',event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+tabs.length)%tabs.length; selectTab(tabs[next]); tabs[next].focus(); } }); });
$('import').addEventListener('click',() => { try { const data = decode($('source').value); loadData(data); $('notice').className=''; $('notice').textContent='Imported Mii decoded successfully'; } catch (err) { $('import-error').textContent=err.message; } });
$('download').addEventListener('click',() => { if (!current || !commitNickname()) return; const url = URL.createObjectURL(new Blob([current.bytes],{type:'application/octet-stream'})); const link = element('a',''); link.href=url; link.download=`${current.name.replace(/[^a-z0-9_-]/gi,'_')}.charinfo`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); });
// Keep the provided payload available even when OpenCourse is temporarily offline.
try { const response = await fetch('/sample.json'); if (!response.ok) throw new Error('Sample unavailable'); loadData(decode(JSON.stringify(await response.json()))); $('notice').textContent = 'Saved example · YNG-5P9-CC8 · Load maker to refresh from OpenCourse'; }
catch (err) { $('notice').className='error'; $('notice').textContent=err.message; }
