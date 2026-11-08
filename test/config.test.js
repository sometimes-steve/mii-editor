import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectUploadConfig,clearUploadConfig,uploadStatus,uploadMii } from '../ocw-upload.mjs';

test('credentials require explicit selection, stay private, and can be forgotten',async()=>{
  clearUploadConfig();
  assert.equal((await uploadStatus()).configured,false);
  await assert.rejects(uploadMii({maker_code:'AAA-AAA-AAA',mii_data:''}),/Choose your/);
  const token='A'.repeat(21); // Invalid-length fixture must be rejected.
  assert.throws(()=>selectUploadConfig({config:{domain:'server.opencourse.world',token},maker_code:'AAA-AAA-AAA'}),/valid OCW config/);
  const valid='A'.repeat(22);
  selectUploadConfig({config:'\uFEFF'+JSON.stringify({domain:'server.opencourse.world',token:valid,ip:'ignored'}),maker_code:'abc-def-123',name:'C:\\fakepath\\my-ocw-config.json'});
  let status=await uploadStatus();
  assert.equal(status.configured,true);assert.equal(status.makerCode,'ABC-DEF-123');assert.equal(status.configName,'my-ocw-config.json');
  assert.equal(JSON.stringify(status).includes(valid),false);assert.equal('token' in status,false);assert.equal('config' in status,false);
  for(const config of ['{',null,[],{domain:'example.com',token:valid},{domain:'server.opencourse.world',token:'\n'+'A'.repeat(21)}]) assert.throws(()=>selectUploadConfig({config,maker_code:'ABC-DEF-123'}));
  assert.throws(()=>selectUploadConfig({config:{domain:'server.opencourse.world',token:valid},maker_code:'wrong'}),/maker code/);
  status=await uploadStatus();assert.equal(status.makerCode,'ABC-DEF-123'); // A rejected file does not silently replace the active one.
  clearUploadConfig();status=await uploadStatus();assert.equal(status.available,false);assert.equal(status.configured,false);assert.equal('configName' in status,false);
});
