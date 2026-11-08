import { createCipheriv, createDecipheriv } from 'node:crypto';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import Mii from '@pretendonetwork/mii-js';
import { editMii, decode } from './public/mii.js';

const wrapKey=Buffer.from('59fc817e6446ea6190347b20e9bdce52','hex');
const MAX_IMAGE_BYTES=8*1024*1024;
export function unwrapQR(payload) {
  const qr=Buffer.from(payload);
  if(qr.length!==112) throw new Error(`Unsupported QR payload (${qr.length} bytes). Use a standard 3DS/Wii U Mii QR code; Switch 2 and game-specific QR formats are not supported yet.`);
  const nonce=Buffer.concat([qr.subarray(0,8),Buffer.alloc(4)]);
  // Wrapped StoreData authenticates a 96-byte plaintext, but omits the final
  // eight ciphertext bytes (known zero padding). Reconstruct those before CCM verification.
  const counter=Buffer.concat([Buffer.from([2]),nonce,Buffer.from([0,0,1])]);
  const stream=createCipheriv('aes-128-ctr',wrapKey,counter).update(Buffer.alloc(96));
  const decipher=createDecipheriv('aes-128-ccm',wrapKey,nonce,{authTagLength:16});
  decipher.setAuthTag(qr.subarray(96));
  decipher.setAAD(Buffer.alloc(0),{plaintextLength:96});
  try {
    const plain=Buffer.concat([decipher.update(Buffer.concat([qr.subarray(8,96),stream.subarray(88)])),decipher.final()]);
    return Buffer.concat([plain.subarray(0,12),qr.subarray(0,8),plain.subarray(12,88)]);
  } catch { throw new Error('The Mii QR data failed its authenticity check. Try a clearer, original QR image.'); }
}

export function changesFromStoreData(storeData) {
  // The library validates StoreData's field ranges and CRC before conversion.
  const m=new Mii(Buffer.from(storeData));
  const hairColor=value=>value===0 ? 8 : value;
  return { name:m.miiName, changes:{
    'Favorite color':m.favoriteColor, Gender:m.gender, Height:Math.min(127,m.height), Build:Math.min(127,m.build),
    'Face shape':m.faceType,'Skin color':m.skinColor,Wrinkles:m.wrinklesType,Makeup:m.makeupType,
    'Hair style':m.hairType,'Hair color':hairColor(m.hairColor),'Hair flip':Number(m.flipHair),
    'Eye style':m.eyeType,'Eye color':m.eyeColor+8,'Eye scale':m.eyeScale,'Eye aspect':m.eyeVerticalStretch,'Eye rotation':m.eyeRotation,'Eye spacing':m.eyeSpacing,'Eye position':m.eyeYPosition,
    'Eyebrow style':m.eyebrowType,'Eyebrow color':hairColor(m.eyebrowColor),'Eyebrow scale':m.eyebrowScale,'Eyebrow aspect':m.eyebrowVerticalStretch,'Eyebrow rotation':m.eyebrowRotation,'Eyebrow spacing':m.eyebrowSpacing,'Eyebrow position':m.eyebrowYPosition,
    'Nose style':m.noseType,'Nose scale':m.noseScale,'Nose position':m.noseYPosition,
    'Mouth style':m.mouthType,'Mouth color':m.mouthColor+19,'Mouth scale':m.mouthScale,'Mouth aspect':m.mouthHorizontalStretch,'Mouth position':m.mouthYPosition,
    'Beard color':hairColor(m.facialHairColor),'Beard style':m.beardType,'Mustache style':m.mustacheType,'Mustache scale':m.mustacheScale,'Mustache position':m.mustacheYPosition,
    'Glasses style':m.glassesType,'Glasses color':m.glassesColor===0 ? 8 : m.glassesColor+13,'Glasses scale':m.glassesScale,'Glasses position':m.glassesYPosition,
    'Mole enabled':Number(m.moleEnabled),'Mole scale':m.moleScale,'Mole X':m.moleXPosition,'Mole Y':m.moleYPosition
  }};
}

export function importQRImage(imageBytes, currentBase64) {
  const bytes=Buffer.from(imageBytes);
  if(bytes.length>MAX_IMAGE_BYTES) throw new Error('QR image is too large (maximum 8 MB).');
  let image;
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    if(bytes.length<24 || bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>4_000_000) throw new Error('QR image is too large (maximum 4 megapixels).');
    image=PNG.sync.read(bytes);
  } else if(bytes[0]===255 && bytes[1]===216) {
    image=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:4,maxMemoryUsageInMB:128});
  } else throw new Error('Upload or paste a PNG or JPEG QR image.');
  if(!image.width || !image.height || image.width*image.height>4_000_000) throw new Error('Invalid or oversized QR image.');
  const code=jsQR(new Uint8ClampedArray(image.data),image.width,image.height,{inversionAttempts:'attemptBoth'});
  if(!code) throw new Error('No QR code found. Copy the enlarged QR image, rather than the Mii portrait.');
  const imported=changesFromStoreData(unwrapQR(code.binaryData));
  const updated=editMii(decode(currentBase64),imported.changes);
  return {mii_data:updated.base64,name:imported.name,format:'3DS/Wii U Mii QR',fields:Object.keys(imported.changes).length};
}

export async function readLimited(response,max=MAX_IMAGE_BYTES) {
  if(!response.ok) throw new Error(`MiiCharacters returned ${response.status}.`);
  const chunks=[]; let count=0;
  for await(const chunk of response.body) { count+=chunk.length; if(count>max) throw new Error('QR response is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function fetchSiteQR(value) {
  let url; try {url=new URL(value);} catch {throw new Error('Enter a MiiCharacters page or QR image URL.');}
  if(url.protocol!=='https:' || !['miicharacters.com','www.miicharacters.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('URL import supports HTTPS links from MiiCharacters.com only.');
  const get=url=>fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(/^\/mii\/\d+\/?$/.test(url.pathname)) {
    const html=(await readLimited(await get(url),2*1024*1024)).toString('utf8');
    const match=html.match(/(?:href|src)=["'](\/miis\/qr_large\/[a-z0-9_.-]+\.(?:jpg|jpeg|png))["']/i);
    if(!match) throw new Error('This MiiCharacters page does not contain a supported QR image.');
    url=new URL(match[1],url);
  } else if(!/^\/miis\/qr_(?:large|thumb)\/[a-z0-9_.-]+\.(?:jpg|jpeg|png)$/i.test(url.pathname)) throw new Error('Use a MiiCharacters character page or QR image link.');
  return readLimited(await get(url));
}
