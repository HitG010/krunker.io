import test from 'node:test';
import assert from 'node:assert/strict';
import {ARENA,SPAWNS,SOLO_SPAWN,spawnPlayer,outsideArena,arenaCollisionBoxes,buildArena,pads,DECK_HEIGHT,practiceTargets} from '../src/arena.js';
import {SHIFT_GATES} from '../src/arena-shift.js';
import {stepPlayer,PLAYER_RADIUS} from '../src/physics.js';
import {rayBox} from '../src/combat.js';
import {RoomHub} from '../server/rooms.js';

const layouts=[{closed:['east']},{closed:['west']}];
function overlaps(p,b){return Math.abs(p.x-b.x)<b.w/2+PLAYER_RADIUS&&Math.abs(p.z-b.z)<b.d/2+PLAYER_RADIUS&&p.y<b.y+b.h/2-.001&&p.y+p.height>b.y-b.h/2+.001;}
// Ground-level navigation is deliberately conservative: decks and low cover
// count as obstacles, so these paths require neither jumps nor special moves.
function navigation(layout){
  const boxes=arenaCollisionBoxes(layout).filter(b=>b.y-b.h/2<1.75&&b.y+b.h/2>0),size=119,offset=59,free=new Uint8Array(size*size);
  const id=(x,z)=>(z+offset)*size+x+offset;
  for(let z=-59;z<=59;z++)for(let x=-59;x<=59;x++)free[id(x,z)]=!boxes.some(b=>overlaps({x,y:0,z,height:1.75},b));
  return {id,free,distances(start){const distance=new Int32Array(free.length).fill(-1),queue=new Int32Array(free.length);let head=0,tail=0;const root=id(start.x,start.z);assert.ok(free[root]);queue[tail++]=root;distance[root]=0;
    while(head<tail){const at=queue[head++],x=at%size,z=Math.floor(at/size);for(const next of [x>0?at-1:-1,x<size-1?at+1:-1,z>0?at-size:-1,z<size-1?at+size:-1])if(next>=0&&free[next]&&distance[next]===-1){distance[next]=distance[at]+1;queue[tail++]=next;}}
    return distance;
  }};
}
test('Switchyard is 120m square and all spawns are clear in both gate layouts',()=>{
  assert.equal(ARENA.size,120);assert.equal(ARENA.size**2/(48**2),6.25);
  for(const layout of layouts)for(const spawn of [...SPAWNS,SOLO_SPAWN]){const p=spawnPlayer(spawn);assert.equal(outsideArena(p),false);assert.equal(arenaCollisionBoxes(layout).some(b=>overlaps(p,b)),false);}
});
test('both layouts connect every spawn, gate approach, and permanent outer route',()=>{
  for(const layout of layouts){const nav=navigation(layout),distance=nav.distances(SOLO_SPAWN);
    for(const p of [...SPAWNS,...SHIFT_GATES.flatMap(g=>[{x:g.x,z:12},{x:g.x,z:-12}]),{x:-55,z:0},{x:55,z:0}])assert.ok(distance[nav.id(p.x,p.z)]>=0,JSON.stringify({layout,p}));
  }
});
test('closing either gate more than doubles its ground-level crossing distance',()=>{
  for(const gate of SHIFT_GATES){const start={x:gate.x,z:12},end={x:gate.x,z:-12};
    const open=navigation({closed:[gate.id==='west'?'east':'west']}),closed=navigation({closed:[gate.id]});
    const direct=open.distances(start)[open.id(end.x,end.z)],detour=closed.distances(start)[closed.id(end.x,end.z)];
    assert.equal(direct,24);assert.ok(detour>=direct*2,`${gate.id}: ${direct}m open, ${detour}m closed`);
    console.log(`${gate.label} crossing: ${direct}m open / ${detour}m closed (ground route)`);
  }
});
test('all four decks can be reached by walking up their stairs',()=>{
  for(const x of [-40,40])for(const side of [-1,1]){const p=spawnPlayer({x,y:0,z:side*39});for(let i=0;i<200;i++)stepPlayer(p,{forward:1,yaw:side>0?Math.PI:0},1/120,arenaCollisionBoxes(layouts[0]),pads);assert.equal(p.y,DECK_HEIGHT);assert.ok(Math.abs(p.z-side*24)<5);}
});
test('each jump pad can launch a player onto its adjacent deck',()=>{
  for(const pad of pads){const p=spawnPlayer({x:pad.x,y:0,z:pad.z});for(let i=0;i<100;i++)stepPlayer(p,{right:Math.sign(pad.x),yaw:0},1/120,arenaCollisionBoxes(layouts[0]),pads);assert.equal(p.y,DECK_HEIGHT);assert.ok(Math.abs(p.x)>34);}
});
test('practice targets and spawn pockets do not intersect solid structures',()=>{
  const boxes=arenaCollisionBoxes({closed:[]});for(const [x,y,z] of practiceTargets)assert.equal(boxes.some(b=>overlaps({x,y:y+.01,z,height:2.4},b)),false,`target at ${x},${y},${z}`);
});
test('relay sightline spans 90m when open and the closed shutter cuts it off',()=>{
  const origin={x:24,y:1.62,z:-45},direction={x:0,y:0,z:1};
  const intersects=layout=>arenaCollisionBoxes(layout).some(b=>rayBox(origin,direction,b,90)!==null);
  assert.equal(intersects({closed:['west']}),false);assert.equal(intersects({closed:['east']}),true);
});
test('rendered solid geometry exactly matches shared static collision',()=>{
  const drawn=[];buildArena((name,x,y,z,w,h,d,material,solid=true)=>{if(solid)drawn.push({x,y,z,w,h,d});});assert.deepEqual(arenaCollisionBoxes({closed:[]}),drawn);
});
test('server permits the expanded yard and recovers only beyond its new boundary',()=>{
  const hub=new RoomHub(),peer=hub.add({readyState:1,bufferedAmount:0,on(){},send(){},terminate(){}});hub.receive(peer,{type:'create',name:'Explorer'});
  Object.assign(peer.player,{x:55,y:0,z:20});hub.step();assert.equal(peer.life,0);assert.equal(peer.player.x,55);
  peer.player.x=ARENA.recoveryLimit+1;hub.step();assert.equal(peer.life,1);assert.equal(outsideArena(peer.player),false);assert.ok(SPAWNS.some(s=>s.x===peer.player.x&&s.z===peer.player.z));
});
