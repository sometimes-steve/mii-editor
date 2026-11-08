import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('./',import.meta.url));
const python=join(root,'.venv',process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command,args) {const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});if(result.error || result.status!==0) throw new Error(`Setup failed: ${command}. Python 3.12 or newer is required.`);}
if(!existsSync(python)) run(process.env.OCW_SETUP_PYTHON || (process.platform==='win32' ? 'python' : 'python3'),['-m','venv','.venv']);
// netifaces2 provides the compatible netifaces import with Windows wheels.
run(python,['-m','pip','install','netifaces2==0.0.22','anyio==4.16.0','pycryptodome==4.4.0','pyopenssl==26.4.0','multidict==7.2.1']);
run(python,['-m','pip','install','--no-deps','nintendoclients==5.1.0','anynet==1.2.2']);
console.log('OCW client ready. Restart npm start to enable direct uploads.');
