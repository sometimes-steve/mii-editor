// nn::mii::CharInfo layout, also documented by ../smm2-dx/recomp/runtime/services/mii.c.
export const fields = [
  ['Font region',38,3], ['Favorite color',39,11], ['Gender',40,1], ['Height',41,127], ['Build',42,127], ['Type',43,1], ['Region move',44,3],
  ['Face shape',45,11], ['Skin color',46,9], ['Wrinkles',47,11], ['Makeup',48,11],
  ['Hair style',49,131], ['Hair color',50,99], ['Hair flip',51,1],
  ['Eye style',52,59], ['Eye color',53,99], ['Eye scale',54,7], ['Eye aspect',55,6], ['Eye rotation',56,7], ['Eye spacing',57,12], ['Eye position',58,18],
  ['Eyebrow style',59,23], ['Eyebrow color',60,99], ['Eyebrow scale',61,8], ['Eyebrow aspect',62,6], ['Eyebrow rotation',63,11], ['Eyebrow spacing',64,12], ['Eyebrow position',65,18],
  ['Nose style',66,17], ['Nose scale',67,8], ['Nose position',68,18],
  ['Mouth style',69,35], ['Mouth color',70,99], ['Mouth scale',71,8], ['Mouth aspect',72,6], ['Mouth position',73,18],
  ['Beard color',74,99], ['Beard style',75,5], ['Mustache style',76,5], ['Mustache scale',77,8], ['Mustache position',78,16],
  ['Glasses style',79,19], ['Glasses color',80,99], ['Glasses scale',81,7], ['Glasses position',82,20],
  ['Mole enabled',83,1], ['Mole scale',84,8], ['Mole X',85,16], ['Mole Y',86,30], ['Reserved',87,255]
];
export function randomChanges(group = 'all', random = Math.random) {
  const ranges = { face:[45,48], hair:[49,51], features:[52,86], proportions:[41,42], all:[41,86] };
  const range = ranges[group];
  if (!range) throw new Error(`Unknown randomization group: ${group}`);
  return Object.fromEntries(fields.filter(([,offset]) => offset >= range[0] && offset <= range[1] && ![43,44].includes(offset)).map(([name,,max]) => {
    const min = name === 'Eyebrow position' ? 3 : 0;
    return [name, min + Math.floor(random() * (max - min + 1))];
  }));
}
export function decode(input) {
  let maker = null;
  let value = input.trim();
  if (value.startsWith('{')) {
    try { maker = JSON.parse(value); } catch { throw new Error('This JSON is incomplete or invalid.'); }
    value = maker.mii?.mii_data ?? maker.mii_data;
    if (typeof value !== 'string') throw new Error('JSON must contain mii.mii_data or mii_data.');
  }
  value = value.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Enter valid base64 Mii data or a maker JSON response.');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length !== 88) throw new Error(`Expected 88-byte Switch CharInfo; received ${bytes.length} bytes.`);
  for (const [name, offset, max] of fields) if (bytes[offset] > max) throw new Error(`${name} is out of range (${bytes[offset]} at byte ${offset}).`);
  const name = new TextDecoder('utf-16le').decode(bytes.slice(16,36)).split('\0')[0];
  return { maker, bytes, name: name || 'Unnamed Mii', base64: value, hex: Array.from(bytes, b => b.toString(16).padStart(2,'0')).join(''), fields: fields.map(([name, offset]) => ({name, offset, value: bytes[offset]})) };
}

// Copy the loaded record so identity bytes, padding and untouched fields survive edits.
export function editMii(data, changes) {
  const bytes = data.bytes.slice();
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'Nickname') {
      if (typeof value !== 'string' || !value.trim() || value.length > 10 || value.includes('\0') || !value.isWellFormed()) throw new Error('Nickname must contain 1–10 UTF-16 code units, without null characters.');
      bytes.fill(0, 16, 36);
      for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i); bytes[16+i*2] = unit & 255; bytes[17+i*2] = unit >> 8; }
    } else {
      const field = fields.find(([name]) => name === key);
      if (!field || field[1] < 39 || [43,44,87].includes(field[1])) throw new Error(`Field is not editable: ${key}`);
      if (!Number.isInteger(value) || value < 0 || value > field[2] || (key === 'Eyebrow position' && value < 3)) throw new Error(`${key} must be between ${key === 'Eyebrow position' ? 3 : 0} and ${field[2]}.`);
      bytes[field[1]] = value;
    }
  }
  const base64 = btoa(String.fromCharCode(...bytes));
  if (!data.maker) return decode(base64);
  const maker = structuredClone(data.maker);
  if (maker.mii) maker.mii.mii_data = base64; else maker.mii_data = base64;
  return decode(JSON.stringify(maker));
}
