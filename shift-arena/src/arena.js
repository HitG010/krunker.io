import {SHIFT_GATES,closedGateBoxes} from './arena-shift.js';
import {makePlayer} from './physics.js';

export const ARENA=Object.freeze({name:'SWITCHYARD',size:120,halfSize:60,recoveryLimit:62,mapExtent:132});
export const SOLO_SPAWN=Object.freeze({x:0,y:0,z:48});
export const SPAWNS=Object.freeze([
  {x:-46,y:0,z:48},{x:46,y:0,z:-48},{x:46,y:0,z:48},{x:-46,y:0,z:-48},{x:0,y:0,z:52},{x:0,y:0,z:-52}
].map(Object.freeze));
export const DECK_HEIGHT=3.5;
export const pads=[{x:-31,z:24},{x:31,z:-24},{x:-31,z:-24},{x:31,z:24}];
export const mapZones=[{label:'CARGO',x:-38,z:40},{label:'RELAY',x:38,z:-40},{label:'SOUTH DEPOT',x:0,z:56},{label:'NORTH DEPOT',x:0,z:-54}];
export function sectorAt(p){return Math.abs(p.x)>51?'OUTER SERVICE ROUTE':Math.abs(p.z)>42?(p.z>0?'SOUTH DEPOT':'NORTH DEPOT'):Math.abs(p.z)<10?'TRANSFER SPINE':p.x<0?'CARGO YARD':'RELAY YARD';}
export const practiceTargets=[
  [0,0,40],[-20,0,35],[22,0,36],[-49,0,18],[49,0,-18],[-24,0,12],[-24,0,-12],[24,0,12],[24,0,-12],
  [-40,DECK_HEIGHT,24],[40,DECK_HEIGHT,-24],[-40,DECK_HEIGHT,-24],[40,DECK_HEIGHT,24],[0,0,-40],[-16,0,-35],[19,0,-35]
];
export function spawnPlayer(spawn=SOLO_SPAWN){return Object.assign(makePlayer(),spawn);}
export function outsideArena(p){return p.y< -10||Math.abs(p.x)>ARENA.recoveryLimit||Math.abs(p.z)>ARENA.recoveryLimit;}

// Rendering and authoritative collision are generated from this same layout.
export function buildArena(box,materials={}){
  const {concrete,lightConcrete,dark,orange,metal,white,cyan,groundMat}=materials;
  const freight=materials.freight??orange,cooling=materials.cooling??cyan;
  box('yard floor',0,-.25,0,120,.5,120,groundMat,false,false);
  for(const side of [-1,1]){
    box('perimeter north south',0,5,side*60,121,10,1,dark);
    box('perimeter east west',side*60,5,0,1,10,120,dark);
    box('perimeter safety trim',0,9.6,side*59.45,120,.2,.12,orange,false);
    for(let n=-54;n<=54;n+=12){
      box('perimeter rib',n,5.5,side*59.4,.5,11,.6,metal,false);
      box('perimeter rib',side*59.4,5.5,n,.6,11,.5,metal,false);
    }
  }
  // The spine cannot be bypassed with a normal jump. Only the two gates and
  // the permanent 8 m outer passages connect the north and south yards.
  box('west spine',-40,4,0,22,8,3,concrete);
  box('central spine',0,4,0,38,8,3,concrete);
  box('east spine',40,4,0,22,8,3,concrete);
  box('switch house',0,7,0,18,14,18,lightConcrete);
  box('switch house roof',0,14.25,0,19,.5,19,dark);
  box('switch house upper band',0,11.5,0,18.1,1,18.1,orange,false);
  box('control tower',0,17,0,6,5,6,dark);
  box('tower lens',0,18.5,0,6.1,.5,6.1,cyan,false);
  box('antenna',0,22,0,.4,6,.4,metal,false);
  for(const gate of SHIFT_GATES){
    const top=gate.y+gate.h/2;
    box(gate.label+' gate lintel',gate.x,top+.3,gate.z,gate.w,.6,3,metal);
    for(const side of [-1,1])box('gate hazard jamb',gate.x+side*(gate.w/2+.25),top/2,0,.5,top,3.1,orange,false);
  }
  // Four observation decks: stairs from the spawn side, jump pads from the yard.
  for(const x of [-40,40])for(const side of [-1,1]){
    const z=side*24;
    box('observation deck',x,DECK_HEIGHT/2,z,12,DECK_HEIGHT,14,lightConcrete);
    for(let i=0;i<7;i++){const h=(i+1)*.5;box('observation stair',x,h/2,side*(37.5-i),5,h,1,concrete);}
    // Broken parapets provide cover but leave the gate-facing edge exposed.
    box('deck rear cover',x-3,DECK_HEIGHT+.7,z+side*5,5,1.4,1,dark);
    box('deck outer cover',x+Math.sign(x)*5.5,DECK_HEIGHT+.7,z,1,1.4,6,dark);
    box('deck stripe',x,DECK_HEIGHT+.02,z-side*6,11,.03,.25,x<0?freight:cooling,false);
  }
  function container(name,x,z,w,d,h=3,material=freight){
    box(name,x,h/2,z,w,h,d,material);
    box(name+' top',x,h+.08,z,w+.1,.16,d+.1,dark,false);
    for(const side of [-1,1])box(name+' band',x,h*.72,z+side*(d/2+.015),w,.16,.025,white,false);
  }
  // Cargo: staggered containers form short, linked pockets without sealing a lane.
  for(const side of [-1,1]){
    container('cargo stack',-17,side*27,8,5,3.4);
    container('cargo stack',-28,side*39,9,4,2.8);
    container('cargo stack',-48,side*12,6,7,3.2);
    container('cargo half stack',-14,side*43,7,4,1.6);
    // Cooling: separated tall housings and low cover allow longer rifle angles.
    container('coolant housing',15,side*28,6,6,5,cooling);
    container('relay housing',29,side*42,7,4,3,cooling);
    container('outer service housing',48,side*12,5,7,3,cooling);
    box('relay low cover',27,.7,side*22,6,1.4,2,lightConcrete);
    box('assembly low cover',7,.65,side*37,7,1.3,2,concrete);
    box('assembly short cover',-7,.65,side*24,5,1.3,2,concrete);
    // Ground-level stepping cover supports movement without vaulting the spine.
    box('step crate',-13,.45,side*15,2,.9,2,dark);
    box('step crate',13,.45,side*15,2,.9,2,dark);
  }
  // Spawn pockets are shielded by cover, with exits on both sides.
  for(const spawn of SPAWNS.slice(0,4)){
    box('spawn shield',spawn.x,1.6,spawn.z-Math.sign(spawn.z)*7,8,3.2,2,lightConcrete);
    box('spawn marker',spawn.x,.02,spawn.z,5,.035,4,metal,false);
  }
  // Inset route markings make the gates legible from either end of the map.
  for(const x of [-24,24])for(let z=-52;z<=52;z+=8){
    if(Math.abs(z)<4)continue;
    box('route dash',x,.02,z,.18,.03,2,x<0?freight:cooling,false,false);
  }
  for(const x of [-55,55])for(let z=-16;z<=16;z+=4)box('outer bypass marking',x,.02,z,.16,.03,1.5,white,false,false);
}
export const collisionBoxes=[];
buildArena((name,x,y,z,w,h,d,material,solid=true)=>{if(solid)collisionBoxes.push({x,y,z,w,h,d});});
export function arenaCollisionBoxes(shift){return [...collisionBoxes,...closedGateBoxes(shift)];}
