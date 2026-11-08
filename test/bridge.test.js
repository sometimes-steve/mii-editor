import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeInfo, stageMii } from '../game-bridge.mjs';
import { decode, editMii } from '../public/mii.js';
const sample=JSON.parse(await readFile(new URL('../public/sample.json',import.meta.url)));
test('stages exact edited bytes, backs up prior Mii, and never claims an OCW save',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ocw-mii-test-'));
  try {
    const backups=join(root,'backups');
    assert.deepEqual(await bridgeInfo(null),{path:null,available:false});
    await assert.rejects(stageMii(null,backups,sample.mii.mii_data),/Set OCW_GAME_DATA_ROOT/);
    await assert.rejects(stageMii(join(root,'missing'),backups,sample.mii.mii_data),/existing folder/);
    const first=await stageMii(root,backups,sample.mii.mii_data); assert.equal(first.backup,false); assert.equal(first.serverSaved,false);
    const edited=editMii(decode(sample.mii.mii_data),{'Favorite color':5});
    const second=await stageMii(root,backups,edited.base64); assert.equal(second.backup,true);
    assert.equal((await readFile(join(root,'mii.charinfo'))).toString('base64'),edited.base64);
    const backup=await readdir(backups); assert.equal(backup.length,1);
    assert.equal((await readFile(join(backups,backup[0]))).toString('base64'),sample.mii.mii_data);
    await assert.rejects(stageMii(root,backups,'not valid!'),/base64/);
    assert.equal((await readFile(join(root,'mii.charinfo'))).toString('base64'),edited.base64);
  } finally { await rm(root,{recursive:true,force:true}); }
});
