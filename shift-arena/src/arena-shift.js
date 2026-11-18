import {PLAYER_RADIUS,STAND_HEIGHT} from './physics.js';

export const SHIFT_INTERVAL_TICKS=45*120;
export const SHIFT_WARNING_TICKS=5*120;
export const SHIFT_GATES=Object.freeze([
  Object.freeze({id:'west',label:'WEST',x:-24,y:4,z:0,w:10,h:8,d:1}),
  Object.freeze({id:'east',label:'EAST',x:24,y:4,z:0,w:10,h:8,d:1})
]);
export function createShift(tick=0,{intervalTicks=SHIFT_INTERVAL_TICKS,warningTicks=SHIFT_WARNING_TICKS}={}){
  return {closed:['east'],phase:'steady',cycle:0,closing:null,opening:null,nextTick:tick+intervalTicks,intervalTicks,warningTicks};
}
export function gateOccupied(gate,players){
  // Include a small safety margin and standing height, even for a sliding player.
  const radius=PLAYER_RADIUS+.2;
  return players.some(p=>Math.abs(p.x-gate.x)<gate.w/2+radius&&Math.abs(p.z-gate.z)<gate.d/2+radius&&p.y<gate.y+gate.h/2+.1&&p.y+Math.max(p.height,STAND_HEIGHT)>gate.y-gate.h/2-.1);
}
export function stepShift(shift,tick,players=[]){
  let changed=false;
  if(shift.phase==='steady'&&tick>=shift.nextTick-shift.warningTicks){
    shift.opening=shift.closed[0];shift.closing=shift.opening==='east'?'west':'east';shift.phase='warning';changed=true;
  }
  if(shift.phase!=='steady'&&tick>=shift.nextTick){
    // Always open the alternate route on time, even if closure has to wait.
    if(shift.closed.length){shift.closed=[];changed=true;}
    const gate=SHIFT_GATES.find(g=>g.id===shift.closing);
    if(gateOccupied(gate,players)){
      if(shift.phase!=='blocked'){shift.phase='blocked';changed=true;}
    }else{
      shift.closed=[shift.closing];shift.phase='steady';shift.closing=null;shift.opening=null;shift.cycle++;shift.nextTick=tick+shift.intervalTicks;changed=true;
    }
  }
  return changed;
}
export function closedGateBoxes(shift){return SHIFT_GATES.filter(g=>shift?.closed.includes(g.id));}
export function shiftSnapshot(shift,tick){return {closed:[...shift.closed],phase:shift.phase,cycle:shift.cycle,closing:shift.closing,opening:shift.opening,remaining:Math.max(0,shift.nextTick-tick)/120};}
