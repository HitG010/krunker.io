import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {WebSocketServer} from 'ws';
import {RoomHub} from './rooms.js';
import {ROOM_CAPACITY} from '../src/multiplayer.js';
export async function startServer({port=5173,host='127.0.0.1',dev=false,matchOptions}={}){
  const root=fileURLToPath(new URL('..',import.meta.url)),dist=resolve(root,'dist');
  const hub=new RoomHub(matchOptions);let vite;
  const server=http.createServer(async(req,res)=>{
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
    if(pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({multiplayer:true,capacity:ROOM_CAPACITY}));return;}
    if(vite){vite.middlewares(req,res);return;}
    const file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
    try{const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404).end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/room'){if(!dev)socket.destroy();return;}
    // Browser requests must originate from this host. Non-browser clients are used by tests.
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){socket.destroy();return;}}catch{socket.destroy();return;}
    if(hub.peers.size>=100*ROOM_CAPACITY+20){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>hub.add(ws));
  });
  try{
    if(dev){const {createServer}=await import('vite');vite=await createServer({root,server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
  }catch(error){await vite?.close();wss.close();throw error;}
  let previous=performance.now(),accumulator=0;
  const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min((now-previous)/1000,.1);previous=now;while(accumulator>=1/120){hub.step();accumulator-=1/120;}},4);
  return {server,hub,port:server.address().port,async close(){clearInterval(timer);hub.close();wss.close();await vite?.close();await new Promise(done=>server.close(done));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const host=process.env.HOST||(process.argv.includes('--lan')?'0.0.0.0':'127.0.0.1');
  try{const app=await startServer({port:Number(process.env.PORT)||5173,host,dev:process.argv.includes('--dev')});console.log(`SHIFT + four-player rooms: http://localhost:${app.port}`);if(host==='0.0.0.0')console.log('LAN enabled: use this computer’s local IP address on the other device.');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}catch(error){console.error(`Could not start SHIFT: ${error.message}`);process.exitCode=1;}
}
