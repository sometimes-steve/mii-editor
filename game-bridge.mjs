import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decode } from './public/mii.js';

export async function bridgeInfo(root) {
  const available = await stat(join(root,'smm2-dx-runtime.exe')).then(s=>s.isFile()).catch(()=>false);
  return { path:join(root,'mii.charinfo'), available };
}
export async function stageMii(root, backupRoot, base64) {
  if (typeof base64 !== 'string') throw new Error('mii_data must be base64 CharInfo.');
  const data = decode(base64);
  if ((data.bytes[8] & 0xc0) !== 0x80 || data.bytes[65] < 3) throw new Error('The Mii has an invalid create ID or eyebrow position for the game.');
  const info = await bridgeInfo(root);
  if (!info.available) throw new Error('No smm2-dx runtime in the configured data folder. Build the patched smm2-dx or set OCW_GAME_DATA_ROOT.');
  let original;
  try { original = await readFile(info.path); } catch(err) { if(err.code !== 'ENOENT') throw err; }
  let backup = false;
  if(original && !original.equals(Buffer.from(data.bytes))) {
    await mkdir(backupRoot,{recursive:true});
    await writeFile(join(backupRoot,`mii-${Date.now()}-${randomUUID()}.charinfo`),original,{flag:'wx'});
    backup=true;
  }
  const temp = join(root,`mii-${randomUUID()}.tmp`);
  await writeFile(temp,data.bytes,{flag:'wx'});
  await rename(temp,info.path);
  return { path:info.path, backup, bytes:88, serverSaved:false };
}
