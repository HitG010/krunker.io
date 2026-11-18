export const RIFLE=Object.freeze({id:'rifle',label:'AR–01 / ASSAULT RIFLE',magazine:30,bodyDamage:25,headDamage:50,fireTicks:15,reloadTicks:150,respawnTicks:360,shieldTicks:120,maxRewindTicks:24,range:100,pellets:1,spread:0,aimFov:65,recoil:.045});
export const WEAPONS=Object.freeze({
  rifle:RIFLE,
  shotgun:Object.freeze({id:'shotgun',label:'SG–02 / SHOTGUN',magazine:6,bodyDamage:16,headDamage:20,fireTicks:96,reloadTicks:264,range:28,pellets:8,spread:.07,aimFov:70,recoil:.095}),
  sniper:Object.freeze({id:'sniper',label:'SR–03 / SNIPER',magazine:5,bodyDamage:90,headDamage:150,fireTicks:132,reloadTicks:300,range:150,pellets:1,spread:0,aimFov:24,recoil:.13})
});
export function isWeapon(id){return typeof id==='string'&&Object.hasOwn(WEAPONS,id);}
export function getWeapon(id){return isWeapon(id)?WEAPONS[id]:RIFLE;}
// A fixed spread pattern keeps solo and server shots consistent. Clients never supply pellets.
export function shotDirections(weapon,yaw,pitch){
  const forward=aimDirection(yaw,pitch),right={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)},up={x:Math.sin(yaw)*Math.sin(pitch),y:Math.cos(pitch),z:Math.cos(yaw)*Math.sin(pitch)};
  return Array.from({length:weapon.pellets},(_,i)=>{
    if(!i)return forward;
    const angle=(i-1)*Math.PI*2/(weapon.pellets-1),radius=i?weapon.spread:0;
    const x=forward.x+radius*(Math.cos(angle)*right.x+Math.sin(angle)*up.x),y=forward.y+radius*Math.sin(angle)*up.y,z=forward.z+radius*(Math.cos(angle)*right.z+Math.sin(angle)*up.z),length=Math.hypot(x,y,z);
    return {x:x/length,y:y/length,z:z/length};
  });
}
export function shotDamage(weapon,hit){
  const falloff=weapon.id==='shotgun'?Math.max(.35,1-Math.max(0,hit.distance-10)/28):1;
  return Math.round((hit.headshot?weapon.headDamage:weapon.bodyDamage)*falloff);
}
export function aimDirection(yaw,pitch){return {x:Math.sin(yaw)*Math.cos(pitch),y:-Math.sin(pitch),z:Math.cos(yaw)*Math.cos(pitch)};}
export function rayBox(origin,direction,box,maxDistance=RIFLE.range){
  let near=0,far=maxDistance;
  for(const [axis,size] of [['x','w'],['y','h'],['z','d']]){
    const min=box[axis]-box[size]/2,max=box[axis]+box[size]/2;
    if(Math.abs(direction[axis])<1e-9){if(origin[axis]<min||origin[axis]>max)return null;continue;}
    let a=(min-origin[axis])/direction[axis],b=(max-origin[axis])/direction[axis];
    if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return null;
  }
  return near;
}
export function traceShot(origin,direction,obstacles,targets,range=RIFLE.range){
  let distance=range,target=null,headshot=false;
  for(const box of obstacles){const d=rayBox(origin,direction,box,distance);if(d!==null)distance=Math.min(distance,d);}
  if(direction.y<0)distance=Math.min(distance,Math.max(0,-origin.y/direction.y));
  for(const opponent of targets){
    const p=opponent.player,h=p.height;
    const body={x:p.x,y:p.y+h*.39,z:p.z,w:.6,h:h*.78,d:.42};
    const head={x:p.x,y:p.y+h*.89,z:p.z,w:.42,h:h*.22,d:.42};
    for(const [box,isHead] of [[body,false],[head,true]]){
      const d=rayBox(origin,direction,box,distance);
      if(d!==null&&d<distance-1e-6){distance=d;target=opponent.id;headshot=isHead;}
    }
  }
  return {target,headshot,distance,to:{x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance}};
}
