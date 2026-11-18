import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {WebSocket} from 'ws';
import {startServer} from '../server/index.js';
import {runtimeConfig,allowedOrigin} from '../server/config.js';

async function fixture(t,extra={}){
  const dir=await mkdtemp(join(tmpdir(),'shift-production-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'assets'));
  await writeFile(join(dir,'index.html'),'<html><body>Game</body></html>');
  const script='console.log("compressed production asset");';await writeFile(join(dir,'assets','index-abcdefgh.js'),script);await writeFile(join(dir,'assets','index-abcdefgh.js.gz'),gzipSync(script));await writeFile(join(dir,'assets','index-abcdefgh.js.br'),brotliCompressSync(script));
  const app=await startServer({port:0,staticDirectory:dir,requireBuild:true,...extra});t.after(()=>app.close());return {...app,url:`http://127.0.0.1:${app.port}`,dir,script};
}
test('production binds publicly, respects environment port, and rejects invalid configuration',()=>{
  assert.deepEqual(runtimeConfig({},[]),{port:5173,host:'0.0.0.0',dev:false,requireBuild:true,publicOrigin:null});
  assert.equal(runtimeConfig({},['--dev']).host,'127.0.0.1');assert.equal(runtimeConfig({},['--dev','--lan']).host,'0.0.0.0');
  assert.equal(runtimeConfig({PORT:'8080',HOST:'::'},[]).port,8080);
  for(const PORT of ['0','-1','65536','abc','1.5',''])assert.throws(()=>runtimeConfig({PORT},[]),/PORT/);
  for(const PUBLIC_ORIGIN of ['bad','https://game.test/path','https://user:secret@game.test','ftp://game.test'])assert.throws(()=>runtimeConfig({PUBLIC_ORIGIN},[]),/PUBLIC_ORIGIN/);
});
test('origin validation accepts the configured public host without trusting forwarded headers',()=>{
  assert.equal(allowedOrigin('https://game.test','internal:5173','https://game.test'),true);
  assert.equal(allowedOrigin('https://evil.test','game.test','https://game.test'),false);
  assert.equal(allowedOrigin('null','game.test'),false);assert.equal(allowedOrigin('https://game.test.evil.test','game.test'),false);
  assert.equal(allowedOrigin(undefined,'game.test'),true);
});
test('production fails before listening when the client build is missing',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'shift-empty-'));t.after(()=>rm(dir,{recursive:true,force:true}));await assert.rejects(startServer({port:0,staticDirectory:dir,requireBuild:true}),/Production build is missing/);
});
test('production serves compressed assets with correct types, caching, HEAD and health responses',async t=>{
  const app=await fixture(t);
  for(const [encoding,expected] of [['br, gzip','br'],['gzip','gzip'],['br;q=0, gzip;q=1','gzip'],['identity',null]]){
    const response=await fetch(app.url+'/assets/index-abcdefgh.js',{headers:{'accept-encoding':encoding}});assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),expected);assert.equal(await response.text(),app.script);assert.match(response.headers.get('cache-control'),/immutable/);assert.match(response.headers.get('content-type'),/javascript/);
  }
  const index=await fetch(app.url);assert.equal(index.headers.get('cache-control'),'no-cache');assert.equal(index.headers.get('x-content-type-options'),'nosniff');
  const head=await fetch(app.url+'/assets/index-abcdefgh.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const health=await fetch(app.url+'/api/health');assert.equal(health.headers.get('cache-control'),'no-store');assert.deepEqual(await health.json(),{status:'ok',multiplayer:true,capacity:4});
});
test('production rejects unsupported methods, hidden files and missing assets',async t=>{
  const app=await fixture(t);assert.equal((await fetch(app.url,{method:'POST'})).status,405);
  assert.equal((await fetch(app.url+'/.env')).status,403);assert.equal((await fetch(app.url+'/%2e%2e%2fsecret')).status,403);assert.equal((await fetch(app.url+'/missing.js')).status,404);
});
test('proxied WebSockets accept the public origin, reject another origin and close on shutdown',async t=>{
  const app=await fixture(t,{publicOrigin:'https://game.test'});
  const rejected=new WebSocket(`ws://127.0.0.1:${app.port}/room`,{origin:'https://evil.test'});await new Promise(resolve=>rejected.once('error',resolve));
  const socket=new WebSocket(`ws://127.0.0.1:${app.port}/room`,{origin:'https://game.test'});await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
  const closed=new Promise(resolve=>socket.once('close',(code,reason)=>resolve({code,reason:reason.toString()})));
  const a=app.close(),b=app.close();assert.equal(a,b);assert.deepEqual(await closed,{code:1012,reason:'Server restarting'});await a;assert.equal(app.hub.peers.size,0);
});
