import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { unwrapQR, changesFromStoreData, importQRImage, fetchSiteQR } from '../qr-import.mjs';
import { decode } from '../public/mii.js';

// Standard 112-byte Mario QR payload from https://www.miicharacters.com/mii/22223.
const payload=Buffer.from('lprJkHy7ivaYDMS6dCii4x3ZVawzA4E6hAR2BHY13hs6XxCBICFNlFz1Xf1DdFxoUKlxfr5J/JuhtRXfdvY2GzwccAoXdUt2AC1+8n2j1rN0MnunjMdpOrctOmPOKEDs4XnCcWC6ruQStCZzJvS9XA==','base64');
const sample=JSON.parse(await readFile(new URL('../public/sample.json',import.meta.url)));
test('authenticates and decrypts a real MiiCharacters QR, then converts Ver3 appearance',()=>{
  const store=unwrapQR(payload); assert.equal(store.length,96);
  const mii=changesFromStoreData(store);
  assert.equal(mii.name,'Mario'); assert.equal(mii.changes['Face shape'],4); assert.equal(mii.changes['Hair style'],62);
  assert.equal(mii.changes['Hair color'],1); assert.equal(mii.changes['Eyebrow color'],8);
  assert.equal(mii.changes['Mouth color'],19); assert.equal(mii.changes['Favorite color'],0);
});
test('scans a QR image and preserves the existing Switch identity and nickname',async()=>{
  const image=await QRCode.toBuffer([{data:payload,mode:'byte'}],{type:'png',scale:6,margin:4});
  const result=importQRImage(image,sample.mii.mii_data);
  const original=decode(sample.mii.mii_data), edited=decode(result.mii_data);
  assert.equal(result.name,'Mario'); assert.equal(edited.name,'Player');
  assert.deepEqual(edited.bytes.slice(0,39),original.bytes.slice(0,39));
  for(const offset of [43,44,87]) assert.equal(edited.bytes[offset],original.bytes[offset]);
  assert.equal(edited.bytes[49],62); assert.notEqual(result.mii_data,original.base64);
});
test('rejects tampered, unrelated, oversized and unsupported QR input',async()=>{
  const tampered=Buffer.from(payload); tampered[20]^=1;
  assert.throws(()=>unwrapQR(tampered),/authenticity/);
  const tag=Buffer.from(payload); tag[111]^=1; assert.throws(()=>unwrapQR(tag),/authenticity/);
  assert.throws(()=>unwrapQR(Buffer.alloc(144)),/Unsupported QR payload/);
  const invalidStore=unwrapQR(payload); invalidStore[48]^=1; assert.throws(()=>changesFromStoreData(invalidStore),/checksum/);
  const unrelated=await QRCode.toBuffer('https://example.com'); assert.throws(()=>importQRImage(unrelated,sample.mii.mii_data),/Unsupported QR payload/);
  const blank=new PNG({width:32,height:32}); blank.data.fill(255); assert.throws(()=>importQRImage(PNG.sync.write(blank),sample.mii.mii_data),/No QR code/);
  assert.throws(()=>importQRImage(Buffer.alloc(8*1024*1024+1),sample.mii.mii_data),/too large/);
  const header=Buffer.alloc(24); Buffer.from('89504e470d0a1a0a','hex').copy(header); header.writeUInt32BE(100000,16);header.writeUInt32BE(100000,20);
  assert.throws(()=>importQRImage(header,sample.mii.mii_data),/megapixels/);
  await assert.rejects(fetchSiteQR('https://example.com/qr.png'),/MiiCharacters/);
  await assert.rejects(fetchSiteQR('https://www.miicharacters.com/admin'),/character page/);
});
