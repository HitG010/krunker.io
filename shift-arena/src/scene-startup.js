import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture.js';

export function createPartnerNameTexture(scene,canvasOrSize={width:512,height:128}){
  const texture=new DynamicTexture('partner name',canvasOrSize,scene);
  // Scene readiness includes disabled meshes. Upload a blank label immediately;
  // waiting for a remote player to draw a name deadlocks solo startup.
  texture.clear();
  texture.update();
  return texture;
}

export function waitForArena(scene,{onReady,onStalled},timeoutMs=20000){
  let done=false;
  const timer=setTimeout(()=>{if(!done)onStalled();},timeoutMs);
  scene.executeWhenReady(()=>{
    if(done)return;
    done=true;clearTimeout(timer);onReady();
  });
  return ()=>{done=true;clearTimeout(timer);};
}
