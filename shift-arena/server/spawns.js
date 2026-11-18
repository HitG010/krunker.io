import {SPAWNS} from '../src/arena.js';
import {rayBox} from '../src/combat.js';

export function chooseSpawn(peer,players,obstacles){
  const opponents=players.filter(p=>p!==peer&&p.entered&&p.health>0);
  const preferred=SPAWNS[(peer.slot||0)%SPAWNS.length];
  if(!opponents.length)return preferred;
  const ranked=SPAWNS.map(spawn=>{
    let nearest=Infinity,exposed=0;
    for(const opponent of opponents){
      const p=opponent.player;nearest=Math.min(nearest,Math.hypot(spawn.x-p.x,spawn.z-p.z));
      const from={x:p.x,y:p.y+p.height-.13,z:p.z},dx=spawn.x-from.x,dy=spawn.y+1-from.y,dz=spawn.z-from.z,length=Math.hypot(dx,dy,dz);
      if(length<.001){exposed++;continue;}
      const direction={x:dx/length,y:dy/length,z:dz/length};
      if(!obstacles.some(box=>rayBox(from,direction,box,length)!==null))exposed++;
    }
    // Avoid nearby enemies first, then favour cover and distance from the nearest threat.
    return {spawn,score:nearest-exposed*30-Math.max(0,24-nearest)*8};
  });
  ranked.sort((a,b)=>b.score-a.score||(a.spawn===preferred?-1:b.spawn===preferred?1:0));
  return ranked[0].spawn;
}
