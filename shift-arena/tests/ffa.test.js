import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,StandardMaterial} from '@babylonjs/core';
import {RoomHub} from '../server/rooms.js';
import {chooseSpawn} from '../server/spawns.js';
import {SPAWNS,spawnPlayer} from '../src/arena.js';
import {RoomClient} from '../src/network.js';
import {createOpponent} from '../src/opponents.js';

function fixture(count=4){
  const hub=new RoomHub({roundTicks:1200,countdownTicks:3});
  function add(name){const messages=[];const p=hub.add({readyState:1,bufferedAmount:0,on(){},send(raw){messages.push(JSON.parse(raw));},terminate(){}});return {p,messages,name};}
  const clients=Array.from({length:count},(_,i)=>add('Player '+i));
  hub.receive(clients[0].p,{type:'create',name:clients[0].name});const room=clients[0].p.room;
  for(const c of clients.slice(1))hub.receive(c.p,{type:'join',name:c.name,code:room.code});
  return {hub,room,clients,players:clients.map(c=>c.p),add};
}
function start({hub,players}){for(const p of players)p.entered=true;hub.step();for(let i=0;i<3;i++)hub.step();}
const input=(p,extra={})=>({seq:p.seq+1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false,life:p.life,...extra});

test('four-player rounds create distinct spawns, freeze scores, choose the top scorer, and require every rematch vote',()=>{
  const f=fixture();start(f);const {hub,room,players}=f;
  assert.equal(room.phase,'active');assert.equal(new Set(players.map(p=>p.player.x+','+p.player.z)).size,4);
  players.forEach((p,i)=>{p.kills=i;p.deaths=4-i;});hub.endRound(room);assert.equal(room.result.winnerId,players[3].id);assert.equal(room.result.standings.length,4);
  const result=JSON.stringify(room.result);for(const p of players)hub.fire(p,{life:p.life});assert.equal(JSON.stringify(room.result),result);
  for(const p of players.slice(0,3))hub.receive(p,{type:'ready',round:room.round});hub.step();assert.equal(room.phase,'ended');
  hub.receive(players[3],{type:'ready',round:room.round});hub.step();assert.equal(room.phase,'countdown');assert.equal(room.round,2);assert.ok(players.every(p=>p.kills===0&&p.deaths===0&&p.health===100));
});
test('a tie for first place remains a draw even when the other two players score less',()=>{
  const f=fixture();start(f);f.players.forEach((p,i)=>p.kills=i<2?5:1);f.hub.endRound(f.room);assert.equal(f.room.result.winnerId,null);
});
test('four-to-three and three-to-two disconnects preserve the match; last opponent leaving ends it',()=>{
  const f=fixture();start(f);const {hub,players,room}=f,endTick=room.endTick;
  hub.remove(players[3]);assert.equal(room.phase,'active');hub.remove(players[2]);assert.equal(room.phase,'active');assert.equal(room.endTick,endTick);
  hub.remove(players[1]);assert.equal(room.phase,'ended');assert.equal(room.result.reason,'forfeit');assert.equal(room.result.winnerId,players[0].id);
});
test('countdown survives a departure if two entered players remain',()=>{
  const f=fixture();for(const p of f.players)p.entered=true;f.hub.step();const startTick=f.room.startTick;
  f.hub.remove(f.players[3]);assert.equal(f.room.phase,'countdown');assert.equal(f.room.startTick,startTick);
  f.hub.remove(f.players[2]);assert.equal(f.room.phase,'countdown');f.hub.remove(f.players[1]);assert.equal(f.room.phase,'waiting');
});
test('late entrants join safely without resetting scores, gate state or the round clock',()=>{
  const f=fixture(2);start(f);const {hub,room,players,add}=f;players[0].kills=3;room.arena.closed=['west'];room.arena.cycle=2;const end=room.endTick;
  const late=add('Late');hub.receive(late.p,{type:'join',name:'Late',code:room.code});
  const first=late.p.life;hub.receive(late.p,{type:'input',frames:[input(late.p,{fire:true})]});hub.step();
  assert.equal(late.p.entered,true);assert.equal(late.p.life,first+1);assert.ok(late.p.shieldUntil>hub.tick);assert.equal(late.p.ammo,30);assert.equal(late.p.ack,1);
  assert.equal(players[0].kills,3);assert.equal(room.endTick,end);assert.equal(room.arena.cycle,2);assert.deepEqual(room.arena.closed,['west']);
  assert.ok(players.every(p=>Math.hypot(p.player.x-late.p.player.x,p.player.z-late.p.player.z)>20));
});
test('two entrants can play while others remain in the lobby; lobby departures do not end their round',()=>{
  const f=fixture();f.players[0].entered=f.players[1].entered=true;f.hub.step();for(let i=0;i<3;i++)f.hub.step();assert.equal(f.room.phase,'active');
  f.hub.remove(f.players[3]);assert.equal(f.room.phase,'active');f.hub.endRound(f.room);assert.equal(f.room.result.standings.length,2);
  for(const p of f.players.slice(0,2))f.hub.receive(p,{type:'ready',round:f.room.round});f.hub.step();assert.equal(f.room.phase,'countdown');
});
test('respawn selection considers the nearest of all living opponents rather than the first opponent',()=>{
  const peer={slot:0},enemies=SPAWNS.slice(0,3).map(s=>({player:spawnPlayer(s),health:100,entered:true}));
  assert.deepEqual(chooseSpawn(peer,[peer,...enemies],[]),SPAWNS[3]);
  const dead={player:spawnPlayer(SPAWNS[3]),health:0,entered:true},lobby={...dead,health:100,entered:false};
  assert.deepEqual(chooseSpawn(peer,[peer,...enemies,dead,lobby],[]),SPAWNS[3]);
});
test('one shotgun shell can kill two opponents while counting one shot and one accurate trigger',()=>{
  const f=fixture();start(f);const [a,b,c,d]=f.players;const {hub,room}=f;
  a.player=spawnPlayer({x:0,y:0,z:18});b.player=spawnPlayer({x:-.5,y:0,z:10});c.player=spawnPlayer({x:.5,y:0,z:10});d.player=spawnPlayer({x:10,y:0,z:10});
  a.weaponId='shotgun';a.ammo=6;a.yaw=Math.PI;a.pitch=0;b.health=c.health=16;for(const p of f.players)p.shieldUntil=0;hub.step();
  hub.fire(a,{life:a.life,viewTick:hub.tick});assert.equal(b.health,0);assert.equal(c.health,0);assert.equal(d.health,100);assert.equal(a.kills,2);assert.equal(a.shots,1);assert.equal(a.hits,1);assert.equal(a.ammo,5);
  const event=f.clients[0].messages.filter(m=>m.kind==='shot').at(-1);assert.equal(event.impacts.length,2);assert.ok(event.impacts.every(hit=>hit.killed));assert.equal(room.phase,'active');
});
test('network interpolation returns all three opponents and removes departures immediately',()=>{
  const client=new RoomClient({onState(){},onClose(){}});client.id='self';
  const snapshots=offset=>['self','a','b','c'].map((id,i)=>({id,yaw:0,pitch:0,life:1,health:100,entered:true,player:{...spawnPlayer(),x:i*10+offset}}));
  client.history=[{at:0,players:snapshots(0)},{at:100,players:snapshots(10)}];client.players=snapshots(10);
  assert.deepEqual(client.remotes(150).map(p=>p.player.x),[15,25,35]);
  client.players=client.players.filter(p=>p.id!=='b');assert.deepEqual(client.remotes(150).map(p=>p.id),['a','c']);
  client.players[1].life=2;client.players[1].player.x=90;assert.equal(client.remotes(150)[0].player.x,90);
});
test('three independent avatars update, hide while paused/dead, and dispose without leaving scene resources',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);engine.updateDynamicTexture=t=>{t.isReady=true;};
  const material=new StandardMaterial('shared',scene),materials={dark:material,metal:material,cyan:material,orange:material};
  const canvas=()=>({width:512,height:128,getContext(){return {clearRect(){},fillRect(){},fillText(){},measureText(){return {width:100};}};}});
  const baseline={meshes:scene.meshes.length,textures:scene.textures.length,materials:scene.materials.length};
  const avatars=Array.from({length:3},(_,i)=>createOpponent(scene,{id:String(i),slot:i,materials,labelCanvas:canvas()}));
  assert.equal(new Set(avatars.map(a=>a.color)).size,3);
  for(const [i,a] of avatars.entries()){const remote={name:'Opponent '+i,player:{...spawnPlayer(),x:i*10},yaw:0,health:100,entered:true,weaponId:i===0?'sniper':'shotgun',shieldRemaining:0};a.update(remote,true,1);assert.equal(a.root.isEnabled(),true);assert.equal(a.root.position.x,i*10);a.update(remote,false,2);assert.equal(a.label.isEnabled(),false);a.update({...remote,health:0},true,2);assert.equal(a.root.isEnabled(),false);a.dispose();}
  assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.textures.length,baseline.textures);assert.equal(scene.materials.length,baseline.materials);scene.dispose();engine.dispose();
});

test('four live game clients share a round, kill credit, death, and respawn',async t=>{
  const {startServer}=await import('../server/index.js');
  const app=await startServer({port:0,matchOptions:{countdownTicks:12}});t.after(()=>app.close());
  const original=globalThis.location;globalThis.location={protocol:'http:',host:`127.0.0.1:${app.port}`};t.after(()=>{if(original===undefined)delete globalThis.location;else globalThis.location=original;});
  const states=new Map(),events=new Map(),clients=Array.from({length:4},(_,i)=>new RoomClient({onState(m){states.set(i,m);},onEvent(m){events.get(i).push(m);},onClose(){}}));
  clients.forEach((_,i)=>events.set(i,[]));t.after(()=>clients.forEach(c=>c.close()));
  const joined=await clients[0].connect('create','Alpha',undefined,'sniper');for(let i=1;i<4;i++)await clients[i].connect('join','Player '+i,joined.code);
  const wait=async predicate=>{const until=Date.now()+3000;while(Date.now()<until){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Four-client combat timed out');};
  for(const c of clients){c.input({forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false,life:0});c.flush();}
  await wait(()=>states.size===4&&[...states.values()].every(m=>m.match.phase==='active'&&m.players.filter(p=>p.entered).length===4));
  const peers=clients.map(c=>app.hub.rooms.get(joined.code).players.get(c.id));
  for(const [i,p] of peers.entries()){p.player=spawnPlayer({x:i<2?0:i===2?6:-6,y:0,z:i===0?18:i===1?14:20});p.shieldUntil=0;p.history=[];}
  await new Promise(r=>setTimeout(r,30));
  clients[0].input({forward:0,right:0,yaw:Math.PI,pitch:0,jump:false,dash:false,slide:false,fire:true,life:peers[0].life});clients[0].flush();
  await wait(()=>[...events.values()].every(list=>list.some(e=>e.kind==='shot'&&e.impacts.some(hit=>hit.target===clients[1].id&&hit.killed))));
  await wait(()=>[...states.values()].every(m=>m.players.find(p=>p.id===clients[0].id).kills===1&&m.players.find(p=>p.id===clients[1].id).health===0));
  const oldLife=peers[1].life;peers[1].respawnAt=app.hub.tick+12;
  await wait(()=>[...states.values()].every(m=>m.players.find(p=>p.id===clients[1].id).life>oldLife));
  for(const client of clients){assert.equal(client.remotes().length,3);assert.equal(new Set(client.players.map(p=>p.slot)).size,4);}
});
