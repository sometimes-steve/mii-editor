import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { decode } from './public/mii.js';

const root=fileURLToPath(new URL('./',import.meta.url));
const python=process.env.OCW_PYTHON || join(root,'.venv',process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');
let selectedConfig=null, makerCode='', configName='';

export function selectUploadConfig(body) {
  let config=body.config;
  if(typeof config==='string') {try {config=JSON.parse(config.replace(/^\uFEFF/,''));} catch {throw new Error('The selected file is not valid JSON.');}}
  if(!config || typeof config!=='object' || Array.isArray(config) || config.domain!=='server.opencourse.world' || typeof config.token!=='string' || config.token.length!==22 || /[\r\n\x00-\x20\x7f]/.test(config.token)) throw new Error('Choose a valid OCW config with domain server.opencourse.world and a 22-character token.');
  const code=String(body.maker_code || '').trim().toUpperCase();
  if(!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) throw new Error('Enter the maker code belonging to this OCW config.');
  selectedConfig=Object.freeze({domain:config.domain,token:config.token});
  makerCode=code;
  configName=String(body.name || 'ocw-config.json').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,100);
}

export function clearUploadConfig() {selectedConfig=null;makerCode='';configName='';}

export async function uploadStatus() {
  try {
    await access(python,constants.F_OK);
    if(!selectedConfig) return {available:false,configured:false,message:'Choose your ocw-config.json and enter its maker code to enable direct upload.'};
    return {available:true,configured:true,makerCode,configName,host:'server.opencourse.world'};
  } catch {return {available:false,configured:!!selectedConfig,makerCode,configName,message:'The OCW Python client is missing. Run npm run setup:ocw, then restart the server.'};}
}

export function runClient(request) {
  if(!selectedConfig || !makerCode) return Promise.reject(new Error('Choose your ocw-config.json before uploading.'));
  const config=selectedConfig, expectedMakerCode=makerCode;
  return new Promise((resolve,reject)=>{
    const child=spawn(python,[join(root,'ocw_client.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error ? reject(error) : resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('OCW upload timed out. Check persistence before retrying.'));},35000);
    child.on('error',()=>finish(new Error('The OCW Python client could not start. Run its setup from README.')));
    child.stdout.on('data',chunk=>{stdout+=chunk; if(stdout.length>65536){child.kill();finish(new Error('Unexpected OCW client output.'));}});
    // Do not forward transport diagnostics or exception traces to the browser.
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      try {const result=JSON.parse(stdout.trim());if(result.error)throw new Error(String(result.error).replaceAll(config.token,'[redacted]'));if(code!==0)throw new Error('The OCW client failed.');finish(null,result);}
      catch(error){finish(new Error(stdout.trim().startsWith('{') ? error.message.replaceAll(config.token,'[redacted]') : 'The OCW client failed to load. Check its Python dependencies.'));}
    });
    child.stdin.end(JSON.stringify({...request,config,expected_maker_code:expectedMakerCode}));
  });
}

export async function getMaker(code) {
  const response=await fetch(`https://server.opencourse.world/api/makers/${encodeURIComponent(code)}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`OCW maker lookup returned ${response.status}.`);
  return response.json();
}

export async function uploadMii(body, options={}) {
  const id=String(body.maker_code || '').toUpperCase();
  const allowed=options.makerCode || makerCode;
  if(!allowed) throw new Error('Choose your ocw-config.json before uploading.');
  if(id!==allowed || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(id)) throw new Error(`Direct upload is configured for ${allowed}. Load that maker before uploading.`);
  if(typeof body.mii_data!=='string') throw new Error('Load or edit a Mii before uploading.');
  const mii=decode(body.mii_data);
  if((mii.bytes[8]&0xc0)!==0x80 || mii.bytes[65]<3) throw new Error('The Mii create ID or eyebrow position is invalid for the game.');
  const lookup=options.getMaker || getMaker, submit=options.runClient || runClient;
  const before=await lookup(id);
  if(before.id!==id || !/^\d+$/.test(String(before.mii?.pid))) throw new Error('OCW did not return the expected maker and PID.');
  const backupFolder=options.backupRoot || join(root,'backups');
  await mkdir(backupFolder,{recursive:true});
  const backup=`ocw-${id}-${Date.now()}-${randomUUID()}.json`;
  await writeFile(join(backupFolder,backup),JSON.stringify({createdAt:new Date().toISOString(),before,requested_mii_data:mii.base64},null,2),{flag:'wx'});
  const ack=await submit({action:'upload',pid:String(before.mii.pid),maker_code:id,mii_data:mii.base64});
  if(ack.submitted!==true || ack.mii_data!==mii.base64) throw new Error('OCW did not acknowledge the requested Mii. Check persistence before retrying.');
  let after,lastError;
  for(let attempt=0;attempt<3;attempt++) {
    if(attempt) await (options.delay || delay)(1000);
    try { after=await lookup(id);if(after.id===id && after.mii?.mii_data===mii.base64) return {submitted:true,verified:true,makerCode:id,verifiedAt:new Date().toISOString(),backup,unchanged:before.mii?.mii_data===mii.base64}; }
    catch(error){lastError=error.message;}
  }
  return {submitted:true,verified:false,makerCode:id,backup,message:lastError ? `Upload acknowledged, but readback failed: ${lastError} Check persistence before retrying.` : 'OCW acknowledged the request, but its public API still returns different Mii bytes. The upload is not verified.'};
}
