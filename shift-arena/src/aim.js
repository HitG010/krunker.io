import {getWeapon} from './combat.js';
export function aimPresentation({held,active,locked,health=100,reloading=false,weaponId='rifle',baseFov=90}){
  const aiming=!!held&&active&&locked&&health>0&&!reloading;
  const fov=aiming?Math.min(baseFov,getWeapon(weaponId).aimFov):baseFov;
  return {aiming,scoped:aiming&&weaponId==='sniper',fov,sensitivity:aiming?Math.tan(fov*Math.PI/360)/Math.tan(baseFov*Math.PI/360):1};
}
