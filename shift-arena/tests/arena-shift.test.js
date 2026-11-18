import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene} from '@babylonjs/core';
import {WebSocket} from 'ws';
import {createShift,stepShift,shiftSnapshot,SHIFT_GATES,gateOccupied} from '../src/arena-shift.js';
import {arenaCollisionBoxes,pads} from '../src/arena.js';
import {makePlayer,stepPlayer} from '../src/physics.js';
import {traceShot} from '../src/combat.js';
import {reconcile} from '../src/network.js';
import {createGateViews} from '../src/gates-view.js';
import {RoomHub} from '../server/rooms.js';
import {startServer} from '../server/index.js';

const west=SHIFT_GATES.find(g=>g.id==='west');
const occupant=()=>({...makePlayer(),x:west.x,y:0,z:west.z});
const advance=(hub,n)=>{for(let i=0;i<n;i++)hub.step();};
function fixture(options={}){
  const hub=new RoomHub({roundTicks:100000,countdownTicks:3,shiftIntervalTicks:24,shiftWarningTicks:12,...options});
  const add=name=>{const messages=[];const peer=hub.add({readyState:1,bufferedAmount:0,on(){},send(raw){messages.push(JSON.parse(raw));},close(){},terminate(){}});return {peer,messages,name};};
  const a=add('Alpha'),b=add('Bravo');hub.receive(a.peer,{type:'create',name:a.name});hub.receive(b.peer,{type:'join',name:b.name,code:a.peer.room.code});
  a.peer.entered=b.peer.entered=true;hub.step();advance(hub,3);
  return {hub,a:a.peer,b:b.peer,room:a.peer.room,messages:a.messages,add};
}

test('first warning is at 40 seconds and routes swap at 45, then alternate',()=>{
  const shift=createShift(100);
  assert.deepEqual(shift.closed,['east']);assert.equal(stepShift(shift,4899),false);
  assert.equal(stepShift(shift,4900),true);assert.equal(shift.phase,'warning');assert.equal(shift.closing,'west');assert.equal(shiftSnapshot(shift,4900).remaining,5);
  stepShift(shift,5499);assert.deepEqual(shift.closed,['east']);
  stepShift(shift,5500);assert.deepEqual(shift.closed,['west']);assert.equal(shift.cycle,1);assert.equal(shift.phase,'steady');assert.equal(shift.nextTick,10900);
  stepShift(shift,10300);assert.equal(shift.closing,'east');stepShift(shift,10900);assert.deepEqual(shift.closed,['east']);assert.equal(shift.cycle,2);
});
test('occupied gate opens the alternative route on time and closes only after clearance',()=>{
  const shift=createShift(),p=occupant();const before={...p};
  stepShift(shift,4800,[p]);stepShift(shift,5400,[p]);assert.equal(shift.phase,'blocked');assert.deepEqual(shift.closed,[]);assert.deepEqual(p,before);
  assert.equal(stepShift(shift,6000,[p]),false);assert.equal(shift.cycle,0);
  p.z+=2;stepShift(shift,6001,[p]);assert.deepEqual(shift.closed,['west']);assert.equal(shift.phase,'steady');assert.equal(shift.nextTick,11401);
});
test('safety checks include radius, crouch, jumping, gate edges, and a clearance margin',()=>{
  assert.equal(gateOccupied(west,[occupant()]),true);
  assert.equal(gateOccupied(west,[{...occupant(),height:1.05}]),true);
  assert.equal(gateOccupied(west,[{...occupant(),x:west.x+west.w/2+.4}]),true);
  assert.equal(gateOccupied(west,[{...occupant(),z:west.z+west.d/2+.4}]),true);
  assert.equal(gateOccupied(west,[{...occupant(),y:west.h-.1}]),true);
  assert.equal(gateOccupied(west,[{...occupant(),y:west.h+1}]),false);
  assert.equal(gateOccupied(west,[{...occupant(),z:west.z+2}]),false);
});
test('closed gate stops walking and dash, open gate permits traversal, replay uses updated collision',()=>{
  const open=createShift(),closed={...open,closed:['west']};
  const start={...makePlayer(),x:west.x,z:west.z-3};
  const frames=Array.from({length:80},(_,i)=>({seq:i+1,yaw:0,forward:1,dash:i===0}));
  for(const [shift,blocked] of [[closed,true],[open,false]]){
    const boxes=arenaCollisionBoxes(shift),p={...start};for(const f of frames)stepPlayer(p,f,1/120,boxes,pads);
    if(blocked)assert.ok(p.z<=west.z-west.d/2-.36+.001);else assert.ok(p.z>west.z+1);
    assert.deepEqual(reconcile(start,frames,0,boxes).player,p);
  }
});
test('gate cover blocks hits while closed and restores the same sightline when open',()=>{
  const origin={x:west.x,y:1.6,z:west.z-3},direction={x:0,y:0,z:1},target={id:'enemy',player:{x:west.x,y:0,z:west.z+3,height:1.75}};
  assert.equal(traceShot(origin,direction,arenaCollisionBoxes({closed:['west']}),[target]).target,null);
  assert.equal(traceShot(origin,direction,arenaCollisionBoxes({closed:['east']}),[target]).target,'enemy');
});
test('rendered shutter geometry and enabled state match shared gate collision',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);try{
    const renderer=createGateViews(scene),shift=createShift();renderer.update(shift);
    for(const {gate,panel} of renderer.views){assert.equal(panel.isEnabled(),shift.closed.includes(gate.id));assert.equal(panel.position.x,gate.x);assert.equal(panel.position.z,gate.z);assert.equal(panel.getBoundingInfo().boundingBox.extendSize.y*2,gate.h);}
    stepShift(shift,5400);renderer.update(shift);assert.equal(renderer.views[0].panel.isEnabled(),true);assert.equal(renderer.views[1].panel.isEnabled(),false);
  }finally{scene.dispose();engine.dispose();}
});
test('server shifts continue while paused, respect paused occupants, ignore dead players, and reset for rematch',()=>{
  const {hub,a,b,room}=fixture();a.player=occupant();hub.receive(a,{type:'pause'});hub.receive(b,{type:'pause'});
  advance(hub,24);assert.equal(room.arena.phase,'blocked');assert.deepEqual(room.arena.closed,[]);assert.equal(a.health,100);
  a.health=0;hub.step();assert.deepEqual(room.arena.closed,['west']);assert.equal(room.arena.cycle,1);
  hub.endRound(room);const frozen=JSON.stringify(room.arena);advance(hub,50);assert.equal(JSON.stringify(room.arena),frozen);
  hub.receive(a,{type:'ready',round:room.round});hub.receive(b,{type:'ready',round:room.round});hub.step();
  assert.equal(room.phase,'countdown');assert.deepEqual(room.arena.closed,['east']);assert.equal(room.arena.cycle,0);assert.equal(room.arena.nextTick,room.startTick+24);
});
test('server gate cover applies even to a shot rewinding an opponent to before closure',()=>{
  const {hub,a,b,room}=fixture();Object.assign(a.player,{x:west.x,y:0,z:west.z-3});Object.assign(b.player,{x:west.x,y:0,z:west.z+3});a.yaw=0;a.pitch=0;a.shieldUntil=b.shieldUntil=0;
  hub.step();const previous=hub.tick;room.arena.closed=['west'];hub.fire(a,{life:a.life,viewTick:previous});assert.equal(b.health,100);assert.equal(a.hits,0);
  room.arena.closed=['east'];a.nextShot=0;hub.fire(a,{life:a.life,viewTick:previous});assert.equal(b.health,50);assert.equal(a.hits,1);
});
test('room states are isolated and joining a finished room receives its current layout',()=>{
  const {hub,a,b,room,add}=fixture();const c=add('Other');hub.receive(c.peer,{type:'create',name:c.name});advance(hub,24);
  assert.deepEqual(room.arena.closed,['west']);assert.deepEqual(c.peer.room.arena.closed,['east']);assert.equal(c.peer.room.arena.phase,'steady');
  hub.remove(b);const replacement=add('Replacement');hub.receive(replacement.peer,{type:'join',name:replacement.name,code:room.code});
  const joined=replacement.messages.find(m=>m.type==='joined');assert.deepEqual(joined.arena.closed,['west']);assert.equal(joined.arena.cycle,1);assert.equal(joined.match.phase,'ended');
  const snap=shiftSnapshot(room.arena,hub.tick);snap.closed.length=0;assert.deepEqual(room.arena.closed,['west']);
});
test('two live clients receive identical warning and gate transitions',async t=>{
  const app=await startServer({port:0,matchOptions:{roundTicks:600,countdownTicks:6,shiftIntervalTicks:48,shiftWarningTicks:24}});t.after(()=>app.close());
  async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/room`),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});t.after(()=>ws.terminate());return {send:m=>ws.send(JSON.stringify(m)),async wait(predicate){const until=Date.now()+3000;while(Date.now()<until){const m=messages.find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,5));}throw Error('Missing gate state');}};}
  const a=await connect(),b=await connect();a.send({type:'create',name:'Alpha'});const joined=await a.wait(m=>m.type==='joined');b.send({type:'join',name:'Bravo',code:joined.code});await b.wait(m=>m.type==='joined');
  const frame={seq:1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false};for(const c of [a,b])c.send({type:'input',frames:[frame]});
  const warnA=await a.wait(m=>m.arena?.phase==='warning'),warnB=await b.wait(m=>m.arena?.phase==='warning');assert.deepEqual(warnA.arena,warnB.arena);assert.equal(warnA.tick,warnB.tick);
  const shiftA=await a.wait(m=>m.arena?.cycle===1),shiftB=await b.wait(m=>m.arena?.cycle===1);assert.deepEqual(shiftA.arena,shiftB.arena);assert.deepEqual(shiftA.arena.closed,['west']);assert.equal(shiftA.tick,shiftB.tick);
});
