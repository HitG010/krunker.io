import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {WebSocketServer} from 'ws';
import {RoomHub} from './rooms.js';
import {ROOM_CAPACITY} from '../src/multiplayer.js';
import {runtimeConfig,normalizePublicOrigin,allowedOrigin} from './config.js';
import {serveAsset} from './assets.js';
export async function startServer({port=5173,host='127.0.0.1',dev=false,matchOptions,staticDirectory,requireBuild=false,publicOrigin=null}={}){
  const root=fileURLToPath(new URL('..',import.meta.url)),dist=resolve(staticDirectory||resolve(root,'dist'));
  publicOrigin=normalizePublicOrigin(publicOrigin);
  if(requireBuild){try{await readFile(resolve(dist,'index.html'));}catch{throw Error('Production build is missing. Run npm run build before starting the server.');}}
  const hub=new RoomHub(matchOptions);let vite,stopping=false,closePromise;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    if(stopping){res.writeHead(503,{'Connection':'close','Cache-Control':'no-store'});res.end('Server restarting');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
    if(pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok',multiplayer:true,capacity:ROOM_CAPACITY}));return;}
    if(vite){vite.middlewares(req,res);return;}
    await serveAsset(req,res,dist,pathname);
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(stopping){socket.destroy();return;}
    if(req.url!=='/room'){if(!dev)socket.destroy();return;}
    // Browser requests must originate from this host. Non-browser clients are used by tests.
    if(!allowedOrigin(req.headers.origin,req.headers.host,publicOrigin)){socket.destroy();return;}
    if(hub.peers.size>=100*ROOM_CAPACITY+20){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>hub.add(ws));
  });
  try{
    if(dev){const {createServer}=await import('vite');vite=await createServer({root,server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
  }catch(error){await vite?.close();wss.close();throw error;}
  let previous=performance.now(),accumulator=0;
  const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min((now-previous)/1000,.1);previous=now;while(accumulator>=1/120){hub.step();accumulator-=1/120;}},4);
  function close(){
    if(closePromise)return closePromise;
    stopping=true;clearInterval(timer);
    closePromise=(async()=>{
      const httpClosed=new Promise(done=>server.close(done)),wsClosed=new Promise(done=>wss.close(done));
      for(const ws of wss.clients)ws.close(1012,'Server restarting');
      const deadline=setTimeout(()=>{for(const ws of wss.clients)ws.terminate();server.closeAllConnections();},1000);deadline.unref();
      try{await vite?.close();await Promise.all([httpClosed,wsClosed]);}finally{clearTimeout(deadline);hub.close();}
    })();return closePromise;
  }
  return {server,hub,port:server.address().port,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const config=runtimeConfig(),app=await startServer(config);console.log(`SHIFT + four-player rooms: http://${config.host}:${app.port}`);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}catch(error){console.error(`Could not start SHIFT: ${error.message}`);process.exitCode=1;}
}
