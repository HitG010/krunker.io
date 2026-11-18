import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlayer,stepPlayer} from '../src/physics.js';
const dt=1/120;
test('diagonal movement does not exceed forward speed',()=>{const a=makePlayer(),b=makePlayer();for(let i=0;i<240;i++){stepPlayer(a,{forward:1},dt,[]);stepPlayer(b,{forward:1,right:1},dt,[]);}assert.ok(Math.abs(Math.hypot(a.vx,a.vz)-Math.hypot(b.vx,b.vz))<.001);});
test('dash cannot tunnel through a thin wall',()=>{const p=makePlayer();p.z=0;const wall={x:0,y:2,z:2,w:5,h:4,d:.1};for(let i=0;i<40;i++)stepPlayer(p,{forward:1,dash:i===0},dt,[wall]);assert.ok(p.z<=1.591);assert.ok(p.charge<100);});
test('jump lands on raised cover',()=>{const p=makePlayer();p.x=0;p.z=0;p.y=3;const box={x:0,y:.5,z:0,w:4,h:1,d:4};for(let i=0;i<240;i++)stepPlayer(p,{},dt,[box]);assert.equal(p.y,1);assert.equal(p.grounded,true);});
test('jump pad launches the player',()=>{const p=makePlayer();stepPlayer(p,{},dt,[],[{x:0,z:18}]);assert.equal(p.vy,14);assert.equal(p.grounded,false);});
test('a spent dash cannot immediately retrigger',()=>{const p=makePlayer();stepPlayer(p,{dash:true},dt,[]);const charge=p.charge;stepPlayer(p,{dash:true},dt,[]);assert.equal(p.charge,charge);assert.ok(p.dashTime<.18);});
test('ceiling stops upward movement',()=>{const p=makePlayer();p.z=0;const ceiling={x:0,y:2.4,z:0,w:5,h:.2,d:5};let max=0;for(let i=0;i<100;i++){stepPlayer(p,{jump:i===0},dt,[ceiling]);max=Math.max(max,p.y+p.height);}assert.ok(max<=2.301);assert.equal(p.grounded,true);});
test('crouched player cannot stand inside low cover',()=>{const p=makePlayer();p.z=0;p.height=1.05;const ceiling={x:0,y:1.5,z:0,w:5,h:.2,d:5};stepPlayer(p,{},dt,[ceiling]);assert.equal(p.height,1.05);});
test('movement recharges dash faster than standing still',()=>{const a=makePlayer(),b=makePlayer();a.charge=0;b.charge=0;for(let i=0;i<120;i++){stepPlayer(a,{forward:1},dt,[]);stepPlayer(b,{},dt,[]);}assert.ok(a.charge>b.charge);assert.ok(a.charge<=100);});

const stairs=Array.from({length:6},(_,i)=>({x:0,y:(i+1)*.25,z:2+i,w:4,h:(i+1)*.5,d:1}));
test('walking climbs all six half-meter stairs without jumping',()=>{
  const p=makePlayer();p.z=0;
  for(let i=0;i<110;i++)stepPlayer(p,{forward:1},dt,stairs);
  assert.ok(p.z>6.5);assert.equal(p.y,3);assert.equal(p.grounded,true);
});
test('walking down stairs stays grounded',()=>{
  const p=makePlayer();p.z=7;p.y=3;
  for(let i=0;i<110;i++){stepPlayer(p,{forward:-1},dt,stairs);assert.equal(p.grounded,true);}
  assert.equal(p.y,0);
});
test('step assistance cannot climb full-height cover',()=>{
  const p=makePlayer();p.z=0;
  for(let i=0;i<120;i++)stepPlayer(p,{forward:1},dt,[{x:0,y:.5,z:2,w:4,h:1,d:1}]);
  assert.ok(p.z<=1.141);assert.equal(p.y,0);
});
test('step assistance respects overhead clearance',()=>{
  const p=makePlayer();p.z=0;
  const boxes=[stairs[0],{x:0,y:2.1,z:1,w:4,h:.2,d:4}];
  for(let i=0;i<120;i++)stepPlayer(p,{forward:1},dt,boxes);
  assert.ok(p.z<=1.141);assert.equal(p.y,0);
});
test('airborne players do not step up into obstacles',()=>{
  const p=makePlayer();p.z=0;p.y=.05;p.vy=-.1;p.grounded=false;p.vz=25;
  stepPlayer(p,{forward:1},.05,[{x:0,y:.25,z:1.5,w:4,h:.5,d:1}]);
  assert.ok(p.z<=.641);assert.ok(p.y<.1);
});
test('dash into slide preserves speed and decays naturally',()=>{
  const p=makePlayer();p.z=0;
  stepPlayer(p,{forward:1,dash:true,slide:true},dt,[]);
  for(let i=0;i<90;i++)stepPlayer(p,{forward:1,slide:true},dt,[]);
  assert.ok(p.vz>21);assert.ok(p.vz<25);assert.equal(p.sliding,true);
});
test('holding slide at rest does not generate a speed boost',()=>{
  const p=makePlayer();for(let i=0;i<240;i++)stepPlayer(p,{forward:1,slide:true},dt,[]);
  assert.ok(Math.hypot(p.vx,p.vz)<=3.5);assert.equal(p.sliding,false);
});
test('slide jump carries speed without movement input',()=>{
  const p=makePlayer();p.vz=20;
  stepPlayer(p,{slide:true,jump:true},dt,[]);const speed=Math.hypot(p.vx,p.vz);
  for(let i=0;i<40;i++)stepPlayer(p,{slide:true},dt,[]);
  assert.ok(p.y>0);assert.ok(Math.abs(Math.hypot(p.vx,p.vz)-speed)<.001);
});
test('slide steering bends gradually and never adds speed',()=>{
  const p=makePlayer();p.vz=20;
  stepPlayer(p,{slide:true,right:1},dt,[]);
  assert.ok(p.vx>0&&p.vx<1);assert.ok(p.vz>19);assert.ok(Math.hypot(p.vx,p.vz)<20);
});
test('dash feedback events fire once per transition',()=>{
  const p=makePlayer();stepPlayer(p,{dash:true},dt,[]);assert.equal(p.dashStarted,true);
  stepPlayer(p,{dash:true},dt,[]);assert.equal(p.dashStarted,false);assert.equal(p.dashDenied,true);
  p.charge=99.99;p.dashWait=0;p.dashTime=0;stepPlayer(p,{},dt,[]);assert.equal(p.dashReady,true);
  stepPlayer(p,{},dt,[]);assert.equal(p.dashReady,false);assert.equal(p.dashDenied,false);
});
