import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3,MeshBuilder,StandardMaterial,DynamicTexture} from '@babylonjs/core';
import {createPartnerNameTexture,waitForArena} from '../src/scene-startup.js';

function fixture(t){
  const engine=new NullEngine();const scene=new Scene(engine);new FreeCamera('camera',new Vector3(0,0,-5),scene);
  // NullEngine omits GPU uploads. Simulate only successful completion of that
  // operation; texture/material/mesh/scene readiness use the real Babylon code.
  engine.updateDynamicTexture=texture=>{texture.isReady=true;};
  const canvas={width:512,height:128,getContext(){return {clearRect(){}};}};
  const mesh=MeshBuilder.CreatePlane('hidden remote label',{},scene);mesh.setEnabled(false);
  const material=new StandardMaterial('name material',scene);mesh.material=material;
  t.after(()=>{scene.dispose();engine.dispose();});
  return {scene,canvas,material};
}

test('an uninitialized hidden nameplate blocks actual Babylon scene readiness',t=>{
  const {scene,canvas,material}=fixture(t);const texture=new DynamicTexture('uninitialized',canvas,scene);material.diffuseTexture=texture;
  assert.equal(texture.isReady(),false);assert.equal(scene.isReady(false),false);
});

test('solo scene becomes ready without any remote player name update',async t=>{
  const {scene,canvas,material}=fixture(t);material.diffuseTexture=createPartnerNameTexture(scene,canvas);
  assert.equal(material.diffuseTexture.isReady(),true);
  const deadline=Date.now()+2000;
  while(!scene.isReady(false)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(scene.isReady(false),true);
  let started=false;waitForArena(scene,{onReady(){started=true;},onStalled(){assert.fail('Initialized scene should not stall');}},1000);
  assert.equal(started,true);
});

test('startup reports a stall and still recovers if the scene later becomes ready',async()=>{
  let readyCallback;const events=[];
  await new Promise(resolve=>{waitForArena({executeWhenReady(fn){readyCallback=fn;}},{onReady(){events.push('ready');},onStalled(){events.push('stalled');resolve();}},10);});
  assert.deepEqual(events,['stalled']);readyCallback();assert.deepEqual(events,['stalled','ready']);readyCallback();assert.equal(events.length,2);
});

test('successful startup cancels its loading timeout',async()=>{
  const events=[];waitForArena({executeWhenReady(fn){fn();}},{onReady(){events.push('ready');},onStalled(){events.push('stalled');}},5);
  await new Promise(r=>setTimeout(r,15));assert.deepEqual(events,['ready']);
});
