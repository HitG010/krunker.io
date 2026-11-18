import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
function encodings(header=''){
  const accepted=new Map(header.toLowerCase().split(',').map(part=>{const [name,...params]=part.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));const weight=q?Number(q.trim().slice(2)):1;return [name,Number.isFinite(weight)&&weight>=0&&weight<=1?weight:0];}));
  return ['br','gzip'].map(name=>({name,q:accepted.get(name)??accepted.get('*')??0})).filter(e=>e.q>0).sort((a,b)=>b.q-a.q).map(e=>e.name);
}
export async function serveAsset(req,res,dist,pathname){
  const file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(resolve(dist)+sep)||pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
  try{
    let data,encoding;
    for(const candidate of encodings(req.headers['accept-encoding'])){
      try{data=await readFile(file+(candidate==='br'?'.br':'.gz'));encoding=candidate;break;}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    data??=await readFile(file);
    res.setHeader('Content-Type',TYPES[extname(file)]||'application/octet-stream');res.setHeader('Vary','Accept-Encoding');
    res.setHeader('Cache-Control',pathname.startsWith('/assets/')&&/[-.][\w-]{8,}\./.test(pathname)?'public, max-age=31536000, immutable':'no-cache');
    if(encoding)res.setHeader('Content-Encoding',encoding);
    res.setHeader('Content-Length',data.length);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404,{'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:'Not found');}
}
