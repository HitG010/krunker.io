import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {RoomHub} from '../server/rooms.js';
import {startServer} from '../server/index.js';

function fixture(){
  const hub=new RoomHub({roundTicks:12,countdownTicks:3});
  function peer(name){const messages=[];const socket={readyState:1,bufferedAmount:0,on(){},send(s){messages.push(JSON.parse(s));},close(){},terminate(){}};const p=hub.add(socket);return {p,messages,name};}
  const a=peer('Alpha'),b=peer('Bravo');hub.receive(a.p,{type:'create',name:a.name});hub.receive(b.p,{type:'join',name:b.name,code:a.p.room.code});return {hub,a:a.p,b:b.p,room:a.p.room,peer};
}
const advance=(hub,n)=>{for(let i=0;i<n;i++)hub.step();};
function start(hub,a,b){a.entered=b.entered=true;hub.step();advance(hub,3);}

test('round waits for both players to enter and uses a countdown',()=>{
  const {hub,a,b,room}=fixture();a.entered=true;advance(hub,10);assert.equal(room.phase,'waiting');
  hub.fire(a,{life:a.life});assert.equal(a.ammo,30);
  b.entered=true;hub.step();assert.equal(room.phase,'countdown');assert.equal(room.round,1);assert.equal(hub.matchSnapshot(room).countdown,3/120);
  hub.fire(a,{life:a.life});assert.equal(a.ammo,30);advance(hub,3);assert.equal(room.phase,'active');assert.equal(hub.matchSnapshot(room).remaining,12/120);
});
test('buzzer fixes the winner and prevents late damage and score changes',()=>{
  const {hub,a,b,room}=fixture();start(hub,a,b);a.kills=3;b.kills=1;advance(hub,12);
  assert.equal(room.phase,'ended');assert.equal(room.result.winnerId,a.id);assert.equal(room.result.reason,'time');
  const ammo=a.ammo,health=b.health;hub.fire(a,{life:a.life});advance(hub,10);assert.equal(a.ammo,ammo);assert.equal(b.health,health);assert.equal(room.result.standings[0].kills,3);
});
test('equal kills produce a draw regardless of deaths',()=>{
  const {hub,a,b,room}=fixture();start(hub,a,b);a.kills=2;b.kills=2;a.deaths=1;b.deaths=9;advance(hub,12);assert.equal(room.result.winnerId,null);
});
test('rematch requires both current players and resets all round state',()=>{
  const {hub,a,b,room}=fixture();start(hub,a,b);a.kills=4;a.deaths=2;a.shots=20;a.hits=10;a.ammo=3;b.health=0;b.respawnAt=1000;advance(hub,12);
  const oldLife=a.life;hub.receive(a,{type:'ready',round:room.round});advance(hub,2);assert.equal(room.phase,'ended');
  hub.receive(b,{type:'ready',round:room.round-1});hub.step();assert.equal(room.phase,'ended');
  hub.receive(b,{type:'ready',round:room.round});hub.step();assert.equal(room.phase,'countdown');assert.equal(room.round,2);assert.equal(a.life,oldLife+1);
  for(const p of [a,b]){assert.equal(p.kills,0);assert.equal(p.deaths,0);assert.equal(p.shots,0);assert.equal(p.hits,0);assert.equal(p.health,100);assert.equal(p.ammo,30);assert.equal(p.reloadUntil,0);assert.equal(p.respawnAt,0);assert.equal(p.queue.length,0);}
});
test('active disconnect awards a forfeit and a replacement can rematch',()=>{
  const {hub,a,b,room,peer}=fixture();start(hub,a,b);hub.remove(b);assert.equal(room.phase,'ended');assert.equal(room.result.reason,'forfeit');assert.equal(room.result.winnerId,a.id);assert.equal(room.result.standings.length,2);
  hub.receive(a,{type:'ready',round:room.round});hub.step();assert.equal(room.phase,'ended');
  const c=peer('Charlie').p;hub.receive(c,{type:'join',name:'Charlie',code:room.code});hub.receive(c,{type:'ready',round:room.round});hub.step();assert.equal(room.phase,'countdown');assert.equal(room.players.size,2);
});
test('disconnect during countdown returns to waiting without a stuck timer',()=>{
  const {hub,a,b,room}=fixture();a.entered=b.entered=true;hub.step();assert.equal(room.phase,'countdown');hub.remove(b);assert.equal(room.phase,'waiting');advance(hub,100);assert.equal(room.phase,'waiting');
});
test('pausing does not stop the authoritative round clock',()=>{
  const {hub,a,b,room}=fixture();start(hub,a,b);hub.receive(a,{type:'pause'});hub.receive(b,{type:'pause'});advance(hub,12);assert.equal(room.phase,'ended');
});

test('two live clients observe countdown, result, ready votes, and round two',async t=>{
  const app=await startServer({port:0,matchOptions:{roundTicks:36,countdownTicks:12}});t.after(()=>app.close());
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/room`),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});t.after(()=>ws.terminate());return {send:m=>ws.send(JSON.stringify(m)),async wait(predicate){const until=Date.now()+4000;while(Date.now()<until){const m=messages.find(predicate);if(m)return m;await delay(5);}throw Error('Round transition timed out');}};}
  const a=await connect(),b=await connect();a.send({type:'create',name:'Alpha'});const joined=await a.wait(m=>m.type==='joined');b.send({type:'join',name:'Bravo',code:joined.code});await b.wait(m=>m.type==='joined');
  const f={seq:1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false};for(const c of [a,b])c.send({type:'input',frames:[f]});
  await a.wait(m=>m.match?.phase==='countdown');await b.wait(m=>m.match?.phase==='active');const result=await a.wait(m=>m.match?.phase==='ended');assert.equal(result.match.result.winnerId,null);
  a.send({type:'ready',round:1});await b.wait(m=>m.match?.ready?.length===1);b.send({type:'ready',round:1});await a.wait(m=>m.match?.round===2&&m.match.phase==='countdown');
});
