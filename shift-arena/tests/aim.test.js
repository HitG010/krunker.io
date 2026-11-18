import test from 'node:test';
import assert from 'node:assert/strict';
import {aimPresentation} from '../src/aim.js';
const base={held:true,active:true,locked:true,health:100,reloading:false,weaponId:'sniper',baseFov:90};
test('holding aim gives the sniper a scoped zoom with proportional mouse sensitivity',()=>{
  const aim=aimPresentation(base);assert.equal(aim.scoped,true);assert.equal(aim.fov,24);assert.ok(aim.sensitivity>.2&&aim.sensitivity<.22);
  const wide=aimPresentation({...base,baseFov:110});assert.ok(wide.sensitivity<aim.sensitivity);
});
test('scope and sensitivity reset on release, pause, death, reload or pointer unlock',()=>{
  for(const change of [{held:false},{active:false},{health:0},{reloading:true},{locked:false}]){
    const aim=aimPresentation({...base,...change});assert.equal(aim.aiming,false);assert.equal(aim.scoped,false);assert.equal(aim.fov,90);assert.equal(aim.sensitivity,1);
  }
});
test('rifle and shotgun aim without the sniper overlay and never zoom out at a low base FOV',()=>{
  for(const weaponId of ['rifle','shotgun']){
    const aim=aimPresentation({...base,weaponId});assert.equal(aim.aiming,true);assert.equal(aim.scoped,false);assert.ok(aim.fov<90);assert.ok(aim.sensitivity<1);
    assert.equal(aimPresentation({...base,weaponId,baseFov:60}).fov,60);
  }
});
