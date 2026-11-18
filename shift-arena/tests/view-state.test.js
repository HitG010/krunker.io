import test from 'node:test';
import assert from 'node:assert/strict';
import {viewPolicy,snapCameraToPlayer} from '../src/view-state.js';

test('paused multiplayer hides the arena and follows authoritative updates',()=>{
  const policy=viewPolicy('paused',true,100);
  assert.equal(policy.hideArena,true);assert.equal(policy.showOpponent,false);assert.equal(policy.followSnapshot,true);assert.equal(policy.canResume,true);
});
test('dying while paused cannot expose opponent movement or resume early',()=>{
  const policy=viewPolicy('paused',true,0);
  assert.equal(policy.hideArena,true);assert.equal(policy.showOpponent,false);assert.equal(policy.followSnapshot,true);assert.equal(policy.canResume,false);
});
test('active death hides the arena until respawn',()=>{
  assert.equal(viewPolicy('active',true,0).hideArena,true);
  assert.equal(viewPolicy('active',true,0).showOpponent,false);
  assert.equal(viewPolicy('active',true,100).hideArena,false);
  assert.equal(viewPolicy('active',true,100).showOpponent,true);
});
test('paused solo stays local and never exposes a network opponent',()=>{
  const policy=viewPolicy('paused',false);
  assert.equal(policy.hideArena,false);assert.equal(policy.followSnapshot,false);assert.equal(policy.showOpponent,false);assert.equal(policy.canResume,true);
});
test('respawn updates the paused camera before the live view is revealed',()=>{
  const camera={position:{set(x,y,z){Object.assign(this,{x,y,z});}},rotation:{set(x,y,z){Object.assign(this,{x,y,z});}}};
  snapCameraToPlayer(camera,{x:2,y:0,z:10,height:1.75},1,.2);
  const respawn={x:-18,y:0,z:-18,height:1.75};
  assert.equal(viewPolicy('paused',true,100).followSnapshot,true);
  snapCameraToPlayer(camera,respawn,Math.PI/4,0);
  assert.equal(camera.position.x,-18);assert.equal(camera.position.z,-18);assert.equal(camera.position.y,1.62);assert.equal(camera.rotation.y,Math.PI/4);
  assert.equal(viewPolicy('paused',true,100).hideArena,true);
  assert.equal(viewPolicy('active',true,100).hideArena,false);
});
