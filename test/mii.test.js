import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decode, editMii, randomChanges } from '../public/mii.js';
const sample = JSON.parse(await readFile(new URL('../public/sample.json',import.meta.url),'utf8'));
test('decodes the actual OpenCourse CharInfo payload and its offsets',() => {
  const mii = decode(JSON.stringify(sample));
  assert.equal(mii.bytes.length,88); assert.equal(mii.name,'Player');
  assert.equal(mii.maker.username,'dark'); assert.equal(mii.bytes[49],33);
  assert.equal(mii.fields.find(f=>f.name==='Height').value,64);
  assert.equal(mii.fields.find(f=>f.name==='Mouth style').value,23);
  assert.equal(Buffer.from(mii.hex,'hex').toString('base64'),sample.mii.mii_data);
});
test('accepts raw base64 with whitespace and flat mii_data JSON',() => {
  assert.equal(decode(`\n${sample.mii.mii_data}\n`).name,'Player');
  assert.equal(decode(JSON.stringify({mii_data:sample.mii.mii_data})).name,'Player');
});
test('rejects corrupt input instead of showing an unrelated Mii',() => {
  for (const input of ['','AAAA','not base64!','{','{}']) assert.throws(()=>decode(input));
  const bytes = Buffer.from(sample.mii.mii_data,'base64'); bytes[49]=255;
  assert.throws(()=>decode(bytes.toString('base64')),/Hair style is out of range/);
});
test('edits only requested bytes and preserves Mii and maker identity',() => {
  const original=decode(JSON.stringify(sample));
  const edited=editMii(original,{'Hair style':42,'Favorite color':5,Nickname:'Test Mii'});
  assert.equal(edited.name,'Test Mii'); assert.equal(edited.bytes[49],42); assert.equal(edited.bytes[39],5);
  assert.equal(original.name,'Player'); assert.equal(original.bytes[49],33);
  assert.equal(edited.maker.id,original.maker.id); assert.equal(edited.maker.mii.id,original.maker.mii.id);
  const touched=new Set([...Array.from({length:20},(_,i)=>i+16),39,49]);
  for(let i=0;i<88;i++) if(!touched.has(i)) assert.equal(edited.bytes[i],original.bytes[i],`byte ${i}`);
  assert.equal(decode(JSON.stringify(edited.maker)).base64,edited.base64);
});
test('edits reject invalid ranges, identities and overlong names',()=>{
  const original=decode(sample.mii.mii_data);
  for(const changes of [{'Hair style':256},{'Height':-1},{'Height':2.5},{'Font region':1},{'Reserved':1},{'Nickname':'12345678901'},{'Nickname':''},{'Eyebrow position':2}]) assert.throws(()=>editMii(original,changes));
  assert.equal(editMii(original,{Nickname:'短名'}).name,'短名');
});
test('randomization stays within each category and preserves identity and profile',()=>{
  const original=decode(JSON.stringify(sample));
  const ranges={face:[45,48],hair:[49,51],features:[52,86],proportions:[41,42],all:[41,86]};
  for(const [group,[start,end]] of Object.entries(ranges)) {
    for(const random of [()=>0,()=>0.999999,Math.random]) {
      const changes=randomChanges(group,random);
      const edited=editMii(original,changes);
      assert.ok(Object.keys(changes).length>0);
      for(let i=0;i<88;i++) if(i<start || i>end || [43,44].includes(i)) assert.equal(edited.bytes[i],original.bytes[i],`${group}: byte ${i}`);
      assert.ok(edited.bytes[65]>=3);
      assert.equal(edited.name,original.name);
      assert.equal(edited.maker.id,original.maker.id);
    }
  }
  assert.throws(()=>randomChanges('unknown'),/Unknown/);
});
