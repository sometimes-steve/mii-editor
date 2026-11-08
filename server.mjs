import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { bridgeInfo, stageMii } from './game-bridge.mjs';
import { importQRImage, fetchSiteQR } from './qr-import.mjs';
import { uploadMii, uploadStatus, selectUploadConfig, clearUploadConfig } from './ocw-upload.mjs';

const root = new URL('./public/', import.meta.url);
const gameRoot = process.env.OCW_GAME_DATA_ROOT ? resolve(process.env.OCW_GAME_DATA_ROOT) : fileURLToPath(new URL('../smm2-dx/dist/smm2-dx_data/', import.meta.url));
const backupRoot = fileURLToPath(new URL('./backups/', import.meta.url));
let staging = false;
let uploading = false;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const files = { '/': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/mii.js': 'mii.js', '/sample.json': 'sample.json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    if(url.pathname==='/api/ocw-config') {
      if(req.method!=='POST'){res.writeHead(405).end();return;}
      if(req.headers.origin!==`http://${req.headers.host}` || req.headers['content-type']!=='application/json'){res.writeHead(403).end(JSON.stringify({error:'Choose a config from the local editor.'}));return;}
      if(uploading) throw new Error('Wait for the current OCW upload before changing credentials.');
      let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>8192)throw new Error('OCW config request is too large.');}
      const input=JSON.parse(body);
      if(input.action==='clear')clearUploadConfig();else selectUploadConfig(input);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(await uploadStatus()));return;
    }
    if(url.pathname==='/api/ocw-upload') {
      if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(await uploadStatus()));return;}
      if(req.method!=='POST'){res.writeHead(405).end();return;}
      if(req.headers.origin!==`http://${req.headers.host}` || req.headers['content-type']!=='application/json'){res.writeHead(403).end(JSON.stringify({error:'Upload from the local editor.'}));return;}
      if(uploading) throw new Error('An OCW upload is already running. Wait for its result.');
      uploading=true;
      try {
        let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>4096)throw new Error('Upload request is too large.');}
        const result=await uploadMii(JSON.parse(body));
        res.writeHead(result.verified ? 200 : 202,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
      } finally {uploading=false;}
      return;
    }
    if(url.pathname==='/api/qr-import') {
      if(req.method!=='POST') {res.writeHead(405).end();return;}
      if(req.headers.origin!==`http://${req.headers.host}` || req.headers['content-type']!=='application/json') {res.writeHead(403).end(JSON.stringify({error:'Import from the local editor.'}));return;}
      const chunks=[]; let size=0;
      for await(const chunk of req) { size+=chunk.length; if(size>12*1024*1024) throw new Error('QR import request is too large.'); chunks.push(chunk); }
      const body=JSON.parse(Buffer.concat(chunks).toString());
      if(typeof body.mii_data!=='string') throw new Error('Load a Mii before importing a QR appearance.');
      if(typeof body.url!=='string' && typeof body.image!=='string') throw new Error('Provide a QR image or MiiCharacters URL.');
      const image=body.url ? await fetchSiteQR(body.url) : Buffer.from(body.image,'base64');
      const result=importQRImage(image,body.mii_data);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return;
    }
    if (url.pathname === '/api/game-mii') {
      if (req.method === 'GET') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(await bridgeInfo(gameRoot))); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(JSON.stringify({error:'Save from the local editor using a same-origin JSON request.'})); return; }
      if(staging) throw new Error('Another local Mii save is running. Try again.');
      staging=true;
      try {
        let body='';
        for await (const chunk of req) { body+=chunk.toString(); if(Buffer.byteLength(body)>4096) throw new Error('Mii save request is too large.'); }
        const result=await stageMii(gameRoot,backupRoot,JSON.parse(body).mii_data);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
      } finally { staging=false; }
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/api/maker') {
      const id = (url.searchParams.get('id') || '').toUpperCase();
      if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(id)) throw new Error('Enter a maker code such as YNG-5P9-CC8.');
      const response = await fetch(`https://server.opencourse.world/api/makers/${id}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`OpenCourse returned ${response.status}. Check the maker code and try again.`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(await response.json()));
      return;
    }
    if (url.pathname === '/api/render') {
      const data = url.searchParams.get('data') || '';
      if (!/^[0-9a-f]{176}$/i.test(data)) throw new Error('Rendering requires 88-byte CharInfo data.');
      const type = url.searchParams.get('type') === 'all_body' ? 'all_body' : 'face';
      const expression = url.searchParams.get('expression') || '0';
      const rotate = url.searchParams.get('rotate') || '0';
      if (!['0', '1', '2', '3', '4', '5'].includes(expression) || !/^-?\d{1,3}$/.test(rotate) || Math.abs(Number(rotate)) > 180) throw new Error('Invalid render controls.');
      const target = new URL('https://mii-unsecure.ariankordi.net/miis/image.png');
      target.search = new URLSearchParams({ data, type, expression, characterYRotate: rotate, width: '512', shaderType: '0' });
      const response = await fetch(target, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('The Mii renderer is unavailable or rejected this Mii. Please try again.');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }).end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = files[url.pathname];
    if (!file) { res.writeHead(404).end('Not found'); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': `${types[ext]}; charset=utf-8` }).end(await readFile(new URL(file, root)));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
  }
});
server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`Mii viewer: http://localhost:${server.address().port}`));
