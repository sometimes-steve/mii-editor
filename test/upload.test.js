import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadMii } from '../ocw-upload.mjs';
import { decode, editMii } from '../public/mii.js';
const before=JSON.parse(await readFile(new URL('../public/sample.json',import.meta.url)));
const edited=editMii(decode(before.mii.mii_data),{Nickname:'Test Mii'}).base64;
test('uploads only the configured maker, backs up first, and requires independent readback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ocw-upload-test-'));
  try {
    let reads=0,submitted=0;
    const result=await uploadMii({maker_code:before.id,mii_data:edited},{makerCode:before.id,backupRoot:root,getMaker:async()=>++reads===1 ? before : {...before,mii:{...before.mii,mii_data:edited}},runClient:async request=>{
      submitted++;assert.equal(request.pid,before.mii.pid);assert.equal(request.mii_data,edited);
      const files=await readdir(root);assert.equal(files.length,1);
      const backup=JSON.parse(await readFile(join(root,files[0])));assert.deepEqual(backup.before,before);
      return {submitted:true,mii_data:edited,pid:'51966'};
    }});
    assert.equal(result.verified,true);assert.equal(result.unchanged,false);assert.equal(submitted,1);assert.equal(reads,2);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('an echoed acknowledgement cannot masquerade as saved server data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ocw-upload-test-'));
  try {
    const result=await uploadMii({maker_code:before.id,mii_data:edited},{makerCode:before.id,backupRoot:root,getMaker:async()=>before,runClient:async()=>({submitted:true,mii_data:edited}),delay:async()=>{}});
    assert.equal(result.submitted,true);assert.equal(result.verified,false);
    await assert.rejects(uploadMii({maker_code:'AAA-AAA-AAA',mii_data:edited},{makerCode:before.id,backupRoot:root}),/configured for/);
    await assert.rejects(uploadMii({maker_code:before.id,mii_data:'invalid!'},{makerCode:before.id,backupRoot:root}),/base64/);
  } finally {await rm(root,{recursive:true,force:true});}
});
