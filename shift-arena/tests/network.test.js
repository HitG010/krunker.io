import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {startServer} from '../server/index.js';
import {RoomHub} from '../server/rooms.js';
import {makePlayer,stepPlayer} from '../src/physics.js';
import {collisionBoxes,pads,ARENA,SPAWNS} from '../src/arena.js';
import {reconcile,interpolate} from '../src/network.js';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function client(port){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/room`),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw)));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,messages,send:m=>ws.send(JSON.stringify(m)),async wait(predicate,timeout=3000){const start=Date.now();while(Date.now()-start<timeout){const m=messages.find(predicate);if(m)return m;await delay(10);}throw Error('Timed out waiting for network message');}};
}
const frame=(seq,overrides={})=>({seq,forward:1,right:0,yaw:Math.PI,pitch:0,slide:false,jump:false,dash:false,...overrides});

test('four clients share movement; a fifth is rejected; disconnect frees a unique slot',async t=>{
  const app=await startServer({port:0});t.after(()=>app.close());
  const [a,b,c,d,fifth]=await Promise.all(Array.from({length:5},()=>client(app.port)));
  t.after(()=>{for(const p of [a,b,c,d,fifth])p.ws.terminate();});
  a.send({type:'create',name:'Alpha'});const joined=await a.wait(m=>m.type==='joined');assert.match(joined.code,/^[A-F0-9]{8}$/);
  for(const [p,name] of [[b,'Bravo'],[c,'Charlie'],[d,'Delta']]){p.send({type:'join',name,code:joined.code});await p.wait(m=>m.type==='joined');}
  const full=await a.wait(m=>m.type==='state'&&m.players.length===4);assert.equal(new Set(full.players.map(p=>p.slot)).size,4);
  fifth.send({type:'join',name:'Echo',code:joined.code});assert.match((await fifth.wait(m=>m.type==='error')).message,/four players/);
  for(let i=0;i<12;i++){a.send({type:'input',frames:Array.from({length:4},(_,j)=>frame(i*4+j+1,{jump:i===1&&j===0,dash:i===2&&j===0,slide:i>=3}))});await delay(34);}
  for(const observer of [b,c,d]){
    const observed=await observer.wait(m=>m.type==='state'&&m.players.some(p=>p.id===joined.id&&p.ack>=48));const moved=observed.players.find(p=>p.id===joined.id);
    assert.ok(moved.player.z<joined.player.z-2);assert.ok(moved.player.y>0);assert.ok(moved.player.charge<100);assert.equal(moved.player.height,1.05);
  }
  a.send({type:'pause'});await b.wait(m=>m.type==='state'&&m.players.some(p=>p.id===joined.id&&p.paused&&p.ack===48));
  b.ws.close();await a.wait(m=>m.type==='state'&&m.players.length===3&&m.players.some(p=>p.ack===48));
  fifth.send({type:'join',name:'Echo',code:joined.code});const replacement=await fifth.wait(m=>m.type==='joined');assert.equal(new Set(replacement.players.map(p=>p.slot)).size,4);
  for(const p of [a,c,d,fifth])p.ws.close();await delay(50);assert.equal(app.hub.rooms.size,0);
  assert.equal((await (await fetch(`http://127.0.0.1:${app.port}/api/health`)).json()).capacity,4);
});

test('unknown room returns a readable error and does not create it',async t=>{
  const app=await startServer({port:0});t.after(()=>app.close());const c=await client(app.port);t.after(()=>c.ws.terminate());
  c.send({type:'join',name:'Runner',code:'DEADBEEF'});assert.match((await c.wait(m=>m.type==='error')).message,/not found/);assert.equal(app.hub.rooms.size,0);
});

test('malformed inputs are disconnected without crashing the server',async t=>{
  const app=await startServer({port:0});t.after(()=>app.close());const c=await client(app.port);t.after(()=>c.ws.terminate());
  c.send({type:'create',name:'Runner'});await c.wait(m=>m.type==='joined');
  const closed=new Promise(resolve=>c.ws.once('close',resolve));c.send({type:'input',frames:[frame(1,{forward:999})]});assert.equal(await closed,1008);
  const response=await fetch(`http://127.0.0.1:${app.port}/api/health`);assert.equal((await response.json()).multiplayer,true);
});

test('rooms are isolated and client-supplied positions are ignored',()=>{
  const hub=new RoomHub();
  function peer(){const sent=[];const socket={readyState:1,bufferedAmount:0,on(){},send(s){sent.push(JSON.parse(s));},close(){},terminate(){}};return {p:hub.add(socket),sent};}
  const a=peer(),b=peer();hub.receive(a.p,{type:'create',name:'A'});hub.receive(b.p,{type:'create',name:'B'});
  hub.receive(a.p,{type:'input',frames:[frame(1,{x:10000,z:10000})]});for(let i=0;i<6;i++)hub.step();
  assert.equal(a.p.player.x,SPAWNS[0].x);assert.ok(a.p.player.z<SPAWNS[0].z);assert.ok(Math.abs(a.p.player.z)<ARENA.halfSize);
  assert.equal(b.sent.at(-1).players.length,1);assert.equal(b.sent.at(-1).players[0].name,'B');
  assert.throws(()=>hub.receive(a.p,{type:'input',frames:[frame(1)]}),/Invalid input/);
});

test('server cannot be sped up by a burst of valid future inputs',()=>{
  const hub=new RoomHub(),socket={readyState:1,bufferedAmount:0,on(){},send(){},close(){},terminate(){}};
  const peer=hub.add(socket);hub.receive(peer,{type:'create',name:'Runner'});
  hub.receive(peer,{type:'input',frames:Array.from({length:12},(_,i)=>frame(i+1))});hub.step();
  assert.equal(peer.ack,1);assert.equal(peer.queue.length,11);assert.ok(SPAWNS[0].z-peer.player.z>0);assert.ok(SPAWNS[0].z-peer.player.z<.1);
});

test('reconciliation replays only unacknowledged inputs with identical collision geometry',()=>{
  const original=makePlayer();original.x=-3;
  const frames=Array.from({length:40},(_,i)=>frame(i+1,{dash:i===0,slide:true}));
  const expected={...original};for(const f of frames)stepPlayer(expected,f,1/120,collisionBoxes,pads);
  const server={...original};for(const f of frames.slice(0,20))stepPlayer(server,f,1/120,collisionBoxes,pads);
  const result=reconcile(server,frames,20);assert.deepEqual(result.player,expected);assert.equal(result.pending.length,20);
});

test('remote interpolation takes the short path across the angle wrap',()=>{
  const a={yaw:Math.PI-.1,pitch:0,player:{x:0,y:0,z:0,height:1.75}},b={yaw:-Math.PI+.1,pitch:.4,player:{x:10,y:2,z:4,height:1.05}};
  const mid=interpolate(a,b,.5);assert.ok(Math.abs(mid.yaw-Math.PI)<.001);assert.equal(mid.player.x,5);assert.equal(mid.player.height,1.4);
});

test('browser networking client joins, predicts, reconciles, pauses, and leaves',async t=>{
  const {RoomClient}=await import('../src/network.js');
  const app=await startServer({port:0});t.after(()=>app.close());
  const original=globalThis.location;globalThis.location={protocol:'http:',host:`127.0.0.1:${app.port}`};t.after(()=>{if(original===undefined)delete globalThis.location;else globalThis.location=original;});
  let predicted,updates=0;
  const a=new RoomClient({onState(m){const self=m.players.find(p=>p.id===a.id);if(self){const r=reconcile(self.player,a.pending,self.ack);predicted=r.player;a.pending=r.pending;updates++;}},onClose(){}});
  const b=new RoomClient({onState(){},onClose(){}});t.after(()=>{a.close();b.close();});
  const joined=await a.connect('create','Alpha',undefined,'sniper');await b.connect('join','Bravo',joined.code,'shotgun');predicted={...joined.player};
  for(let i=0;i<10;i++){
    for(let j=0;j<4;j++){const input=frame(0,{dash:i===0&&j===0,slide:true});delete input.seq;stepPlayer(predicted,input,1/120,collisionBoxes,pads);a.input(input);}
    await delay(33);
  }
  a.pause();await delay(180);
  assert.ok(updates>3);assert.equal(a.pending.length,0);assert.ok(b.remote());assert.ok(predicted.z<joined.player.z-2);
  assert.equal(a.players.length,2);assert.equal(b.remote().name,'Alpha');assert.equal(b.remote().weaponId,'sniper');assert.equal(a.remote().weaponId,'shotgun');assert.equal(a.players.find(p=>p.id===a.id).ammo,5);assert.equal(b.players.find(p=>p.id===b.id).ammo,6);
  b.close();await delay(160);assert.equal(a.players.length,1);assert.equal(a.remote(),null);
});
