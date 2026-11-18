import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {RIFLE,WEAPONS,shotDirections,shotDamage,rayBox,aimDirection,traceShot} from '../src/combat.js';
import {RoomHub} from '../server/rooms.js';
import {startServer} from '../server/index.js';

function setup(weaponId='rifle'){
  const hub=new RoomHub();
  function add(name){const messages=[];const socket={readyState:1,bufferedAmount:0,on(){},send(s){messages.push(JSON.parse(s));},close(){},terminate(){}};const peer=hub.add(socket);return {peer,messages,name};}
  const a=add('Alpha'),b=add('Bravo');hub.receive(a.peer,{type:'create',name:a.name,weaponId});hub.receive(b.peer,{type:'join',name:b.name,code:a.peer.room.code});
  a.peer.room.phase='active';a.peer.room.endTick=100000;
  Object.assign(a.peer.player,{x:0,y:0,z:18});Object.assign(b.peer.player,{x:0,y:0,z:14});
  for(const {peer} of [a,b]){peer.entered=true;peer.shieldUntil=0;peer.paused=false;}
  a.peer.yaw=Math.PI;a.peer.pitch=.15;hub.step();
  return {hub,a:a.peer,b:b.peer,messages:a.messages};
}
function shoot(hub,peer,extra={}){hub.fire(peer,{life:peer.life,viewTick:hub.tick,...extra});}
function advance(hub,ticks){for(let i=0;i<ticks;i++)hub.step();}

test('ray intersection handles parallel rays, walls behind the origin, and range',()=>{
  const box={x:0,y:1,z:5,w:2,h:2,d:1},origin={x:0,y:1,z:0};
  assert.equal(rayBox(origin,{x:0,y:0,z:1},box),4.5);
  assert.equal(rayBox(origin,{x:0,y:0,z:-1},box),null);
  assert.equal(rayBox({x:3,y:1,z:0},{x:0,y:0,z:1},box),null);
  assert.equal(rayBox(origin,{x:0,y:0,z:1},box,4),null);
});
test('body and head hitboxes follow crouch height',()=>{
  const target={id:'target',player:{x:0,y:0,z:5,height:1.75}};
  let result=traceShot({x:0,y:1,z:0},{x:0,y:0,z:1},[],[target]);assert.equal(result.target,'target');assert.equal(result.headshot,false);
  result=traceShot({x:0,y:1.6,z:0},{x:0,y:0,z:1},[],[target]);assert.equal(result.headshot,true);
  target.player.height=1.05;result=traceShot({x:0,y:1.6,z:0},{x:0,y:0,z:1},[],[target]);assert.equal(result.target,null);
  result=traceShot({x:0,y:.95,z:0},{x:0,y:0,z:1},[],[target]);assert.equal(result.headshot,true);
});
test('solid cover blocks player hits and floor blocks downward shots',()=>{
  const target={id:'target',player:{x:0,y:0,z:5,height:1.75}};
  const result=traceShot({x:0,y:1,z:0},{x:0,y:0,z:1},[{x:0,y:1,z:2,w:3,h:2,d:.1}],[target]);assert.equal(result.target,null);assert.equal(result.distance,1.95);
  assert.equal(traceShot({x:0,y:1,z:0},{x:0,y:-1,z:0},[],[]).distance,1);
});
test('server applies body damage, cadence, headshots, and exactly one kill',()=>{
  const {hub,a,b,messages}=setup();shoot(hub,a);assert.equal(b.health,75);assert.equal(a.ammo,29);
  shoot(hub,a);assert.equal(b.health,75);assert.equal(a.ammo,29);
  advance(hub,RIFLE.fireTicks);a.pitch=0;shoot(hub,a);assert.equal(b.health,25);
  advance(hub,RIFLE.fireTicks);shoot(hub,a);assert.equal(b.health,0);assert.equal(a.kills,1);assert.equal(b.deaths,1);assert.ok(b.respawnAt>hub.tick);
  advance(hub,RIFLE.fireTicks);shoot(hub,a);assert.equal(a.kills,1);assert.equal(b.deaths,1);
  assert.equal(messages.filter(m=>m.kind==='shot'&&m.killed).length,1);
});
test('dead players cannot shoot or move, then respawn with full health and fresh ammo',()=>{
  const {hub,a,b}=setup();b.health=0;b.respawnAt=hub.tick+RIFLE.respawnTicks;b.ammo=2;b.deaths=1;
  const position={...b.player};shoot(hub,b);assert.equal(b.ammo,2);assert.equal(a.health,100);
  hub.receive(b,{type:'input',frames:[{seq:1,forward:1,right:0,yaw:0,pitch:0,jump:true,dash:true,slide:false,fire:true,life:0}]});hub.step();assert.equal(b.player.z,position.z);assert.equal(b.ack,1);
  advance(hub,RIFLE.respawnTicks);assert.equal(b.health,100);assert.equal(b.ammo,30);assert.equal(b.life,1);assert.equal(b.deaths,1);assert.ok(b.shieldUntil>hub.tick);assert.ok(Math.hypot(b.player.x-a.player.x,b.player.z-a.player.z)>20);
});
test('manual reload blocks fire and cannot complete early',()=>{
  const {hub,a,b}=setup();a.ammo=4;
  hub.receive(a,{type:'input',frames:[{seq:1,forward:0,right:0,yaw:Math.PI,pitch:.15,jump:false,dash:false,slide:false,reload:true,fire:true}]});hub.step();
  assert.equal(a.ammo,4);assert.equal(b.health,100);assert.equal(a.reloadUntil,hub.tick+RIFLE.reloadTicks);
  advance(hub,RIFLE.reloadTicks-1);shoot(hub,a);assert.equal(a.ammo,4);
  hub.step();assert.equal(a.ammo,30);assert.equal(a.reloadUntil,0);
});
test('empty magazine triggers automatic reload; no free shots',()=>{
  const {hub,a,b}=setup();a.ammo=1;shoot(hub,a);assert.equal(a.ammo,0);assert.equal(b.health,75);assert.ok(a.reloadUntil>hub.tick);
  advance(hub,20);shoot(hub,a);assert.equal(b.health,75);advance(hub,RIFLE.reloadTicks);assert.equal(a.ammo,30);
});
test('spawn protection blocks incoming damage and ends when firing',()=>{
  const {hub,a,b}=setup();b.shieldUntil=hub.tick+120;shoot(hub,a);assert.equal(b.health,100);assert.equal(a.hits,0);
  b.yaw=0;b.pitch=.15;shoot(hub,b);assert.equal(b.shieldUntil,0);assert.equal(a.health,75);
  advance(hub,RIFLE.fireTicks);shoot(hub,a);assert.equal(b.health,75);
});
test('players still in the lobby cannot be hit',()=>{
  const {hub,a,b}=setup();b.entered=false;shoot(hub,a);assert.equal(b.health,100);
});
test('bounded rewind hits the rendered historical position but not an old life',()=>{
  const {hub,a,b}=setup();a.pitch=0;hub.tick=100;
  b.player.x=8;b.history=[{tick:76,life:0,health:100,player:{...b.player}},{tick:88,life:0,health:100,player:{...b.player,x:0}},{tick:100,life:0,health:100,player:{...b.player}}];
  shoot(hub,a,{viewTick:88});assert.equal(b.health,50);
  a.nextShot=0;b.health=100;shoot(hub,a,{viewTick:0});assert.equal(b.health,100);
  a.nextShot=0;b.life=1;shoot(hub,a,{viewTick:88});assert.equal(b.health,100);
});
test('old-life queued fire cannot shoot after respawn',()=>{
  const {hub,a,b}=setup();a.life=1;
  hub.receive(a,{type:'input',frames:[{seq:1,forward:1,right:0,yaw:Math.PI,pitch:0,jump:false,dash:false,slide:false,fire:true,life:0}]});hub.step();assert.equal(a.ammo,30);assert.equal(b.health,100);assert.equal(a.ack,1);
});
test('invalid combat fields are rejected',()=>{
  const {hub,a}=setup();const frame={seq:1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false};
  for(const extra of [{fire:'yes'},{reload:1},{viewTick:-10},{life:1.5}])assert.throws(()=>hub.receive(a,{type:'input',frames:[{...frame,...extra}]}),/Invalid combat input/);
});

test('paused victim receives death and respawn snapshots without resuming',async t=>{
  const app=await startServer({port:0});t.after(()=>app.close());
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/room`),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});t.after(()=>ws.terminate());return {ws,messages,send:m=>ws.send(JSON.stringify(m)),async wait(predicate){const start=Date.now();while(Date.now()-start<6000){const m=messages.find(predicate);if(m)return m;await delay(10);}throw Error('No combat event');}};}
  const a=await connect(),b=await connect();a.send({type:'create',name:'Alpha'});const joined=await a.wait(m=>m.type==='joined');b.send({type:'join',name:'Bravo',code:joined.code});const joinedB=await b.wait(m=>m.type==='joined');
  const room=app.hub.rooms.get(joined.code);room.phase='active';room.endTick=100000;const pa=room.players.get(joined.id),pb=room.players.get(joinedB.id);
  Object.assign(pa.player,{x:0,y:0,z:18});Object.assign(pb.player,{x:0,y:0,z:14});pa.entered=true;pb.entered=true;pa.shieldUntil=0;pb.shieldUntil=0;
  b.send({type:'pause'});await b.wait(m=>m.type==='state'&&m.players.some(p=>p.id===joinedB.id&&p.paused));
  for(let i=0;i<15;i++){a.send({type:'input',frames:Array.from({length:4},(_,j)=>({seq:i*4+j+1,forward:0,right:0,yaw:Math.PI,pitch:.15,jump:false,dash:false,slide:false,fire:true,life:0}))});await delay(34);}
  const death=await b.wait(m=>m.kind==='shot'&&m.killed);assert.equal(death.target,joinedB.id);
  const score=await a.wait(m=>m.type==='state'&&m.players.some(p=>p.kills===1));assert.equal(score.players.find(p=>p.id===joinedB.id).health,0);
  const respawn=await b.wait(m=>m.type==='state'&&m.players.some(p=>p.id===joinedB.id&&p.life===1));const self=respawn.players.find(p=>p.id===joinedB.id);assert.equal(self.health,100);assert.equal(self.paused,true);assert.notEqual(self.player.z,14);
});


test('loadouts are validated on joining and remain fixed through respawn and rematch',()=>{
  const {hub,a}=setup('sniper');
  assert.equal(a.ammo,5);assert.equal(hub.snapshot(a.room)[0].weaponId,'sniper');
  a.ammo=1;hub.respawn(a);assert.equal(a.ammo,5);assert.equal(a.weaponId,'sniper');
  hub.beginRound(a.room);assert.equal(a.ammo,5);assert.equal(a.weaponId,'sniper');
  for(const weaponId of ['laser','__proto__','toString',{},null]){
    const peer=hub.add({readyState:1,bufferedAmount:0,on(){},send(){}});
    assert.throws(()=>hub.receive(peer,{type:'create',name:'Invalid',weaponId}),/Invalid weapon/);
    assert.equal(peer.room,null);
  }
});
test('sniper deals 90 body damage, respects its slow cadence, and kills with a headshot',()=>{
  const {hub,a,b,messages}=setup('sniper');shoot(hub,a,{damage:999,pellets:99});
  assert.equal(b.health,10);assert.equal(a.ammo,4);assert.equal(a.nextShot,hub.tick+132);
  advance(hub,131);shoot(hub,a);assert.equal(a.ammo,4);
  hub.step();b.health=100;a.pitch=0;shoot(hub,a);
  assert.equal(b.health,0);assert.equal(a.kills,1);assert.equal(a.ammo,3);
  const event=messages.filter(m=>m.kind==='shot').at(-1);assert.equal(event.damage,150);assert.equal(event.weaponId,'sniper');assert.equal(event.headshot,true);
});
test('shotgun resolves eight pellets as one shell, one hit statistic, and one kill',()=>{
  const {hub,a,b,messages}=setup('shotgun');shoot(hub,a);
  assert.equal(a.ammo,5);assert.equal(a.shots,1);assert.equal(a.hits,1);assert.equal(a.kills,1);assert.equal(b.deaths,1);
  const event=messages.find(m=>m.kind==='shot');assert.equal(event.pellets.length,8);assert.ok(event.damage>=100);assert.equal(event.weaponId,'shotgun');
  shoot(hub,a);assert.equal(a.ammo,5);assert.equal(b.deaths,1);
});
test('shotgun spread is normalized and bounded, damage falls off, and cover blocks every pellet',()=>{
  const weapon=WEAPONS.shotgun,origin={x:0,y:1,z:0},targets=[{id:'target',player:{x:0,y:0,z:5,height:1.75}}];
  const directions=shotDirections(weapon,0,0);assert.equal(directions.length,8);
  for(const direction of directions){assert.ok(Math.abs(Math.hypot(direction.x,direction.y,direction.z)-1)<1e-10);assert.ok(direction.z>.99);
    assert.equal(traceShot(origin,direction,[{x:0,y:1,z:2,w:3,h:3,d:.1}],targets,weapon.range).target,null);
  }
  assert.ok(shotDamage(weapon,{distance:25,headshot:false})<shotDamage(weapon,{distance:5,headshot:false}));
  assert.equal(traceShot(origin,{x:0,y:0,z:1},[],[{id:'far',player:{x:0,y:0,z:29,height:1.75}}],weapon.range).target,null);
  assert.equal(traceShot(origin,{x:0,y:0,z:1},[],[{id:'far',player:{x:0,y:0,z:125,height:1.75}}],WEAPONS.sniper.range).target,'far');
});
for(const weaponId of ['shotgun','sniper'])test(weaponId+' reload duration and capacity are enforced by the server',()=>{
  const {hub,a}=setup(weaponId),weapon=WEAPONS[weaponId];a.ammo=1;shoot(hub,a);
  assert.equal(a.ammo,0);assert.equal(a.reloadUntil,hub.tick+weapon.reloadTicks);
  advance(hub,weapon.reloadTicks-1);shoot(hub,a);assert.equal(a.ammo,0);
  hub.step();assert.equal(a.ammo,weapon.magazine);assert.equal(a.reloadUntil,0);
  a.ammo=1;hub.receive(a,{type:'input',frames:[{seq:1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false,reload:true,weaponId:'rifle',damage:999}]});hub.step();
  assert.equal(a.weaponId,weaponId);assert.equal(a.reloadUntil,hub.tick+weapon.reloadTicks);
});
