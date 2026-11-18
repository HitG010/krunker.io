export const PLAYER_RADIUS = 0.36;
export const STAND_HEIGHT = 1.75;
export const SLIDE_HEIGHT = 1.05;
export const STEP_HEIGHT = 0.55;
const RUN_SPEED = 8.5;
const SLIDE_MIN_SPEED = 4.5;
const EPSILON = 0.001;

export function makePlayer() {
  return { x:0, y:0, z:18, vx:0, vy:0, vz:0, height:STAND_HEIGHT,
    grounded:true, sliding:false, charge:100, dashTime:0, dashWait:0,
    padWait:0, stepDelta:0, dashStarted:false, dashReady:false, dashDenied:false };
}
function horizontalOverlap(p,b) {
  return p.x+PLAYER_RADIUS>b.x-b.w/2 && p.x-PLAYER_RADIUS<b.x+b.w/2 &&
    p.z+PLAYER_RADIUS>b.z-b.d/2 && p.z-PLAYER_RADIUS<b.z+b.d/2;
}
function overlaps(p,b) {
  return horizontalOverlap(p,b) && p.y+p.height>b.y-b.h/2+EPSILON && p.y<b.y+b.h/2-EPSILON;
}
function tryStep(p,axis,previous,boxes,blockers) {
  const rise=Math.max(...blockers.map(b=>b.y+b.h/2-p.y));
  if(rise<=EPSILON || rise>STEP_HEIGHT+EPSILON)return false;
  // Check both the upward sweep at the old location and clearance at the destination.
  const sweep={...p,[axis]:previous,height:p.height+rise};
  const raised={...p,y:p.y+rise};
  if(boxes.some(b=>overlaps(sweep,b)||overlaps(raised,b)))return false;
  p.y+=rise;p.stepDelta+=rise;
  return true;
}
export function moveAxis(p,axis,amount,boxes,canStep=false) {
  if(!amount)return;
  const previous=p[axis];
  p[axis]+=amount;
  const blockers=boxes.filter(b=>overlaps(p,b));
  if(canStep && axis!=='y' && blockers.length && tryStep(p,axis,previous,boxes,blockers))return;
  for(const b of blockers) {
    if(!overlaps(p,b))continue;
    if(axis==='x'){p.x=amount>0?b.x-b.w/2-PLAYER_RADIUS:b.x+b.w/2+PLAYER_RADIUS;p.vx=0;}
    if(axis==='z'){p.z=amount>0?b.z-b.d/2-PLAYER_RADIUS:b.z+b.d/2+PLAYER_RADIUS;p.vz=0;}
    if(axis==='y'){p.y=amount>0?b.y-b.h/2-p.height:b.y+b.h/2;p.vy=0;if(amount<0)p.grounded=true;}
  }
}
function slideVelocity(p,dx,dz,hasInput,dt) {
  const speed=Math.hypot(p.vx,p.vz);
  let heading=Math.atan2(p.vx,p.vz);
  if(hasInput){
    const target=Math.atan2(dx,dz);
    const difference=Math.atan2(Math.sin(target-heading),Math.cos(target-heading));
    // Steering bends the line without redirecting all of the player's momentum instantly.
    heading+=Math.max(-1.5*dt,Math.min(1.5*dt,difference));
  }
  const nextSpeed=Math.max(0,speed-4*dt);
  p.vx=Math.sin(heading)*nextSpeed;p.vz=Math.cos(heading)*nextSpeed;
}
export function stepPlayer(p,input,dt,boxes,pads=[]) {
  p.stepDelta=0;p.dashStarted=false;p.dashReady=false;p.dashDenied=false;
  const wasGrounded=p.grounded;
  const previousCharge=p.charge;
  const nextHeight=input.slide?SLIDE_HEIGHT:STAND_HEIGHT;
  if(nextHeight<p.height)p.height=nextHeight;
  else{const old=p.height;p.height=nextHeight;if(boxes.some(b=>overlaps(p,b)))p.height=old;}
  let ix=input.right||0,iz=input.forward||0;
  const len=Math.hypot(ix,iz);if(len>1){ix/=len;iz/=len;}
  const sin=Math.sin(input.yaw||0),cos=Math.cos(input.yaw||0);
  let dx=ix*cos+iz*sin,dz=-ix*sin+iz*cos;
  p.dashWait=Math.max(0,p.dashWait-dt);p.padWait=Math.max(0,p.padWait-dt);
  if(input.dash){
    if(p.charge>=100&&p.dashWait===0){
      if(!len){dx=sin;dz=cos;}
      p.vx=dx*25;p.vz=dz*25;p.dashTime=.18;p.dashWait=1;p.charge=0;p.dashStarted=true;
    }else p.dashDenied=true;
  }
  p.sliding=!!input.slide && wasGrounded && Math.hypot(p.vx,p.vz)>SLIDE_MIN_SPEED;
  if(p.dashTime>0)p.dashTime=Math.max(0,p.dashTime-dt);
  else if(p.sliding)slideVelocity(p,dx,dz,len>0,dt);
  else if(wasGrounded){
    const speed=p.height<STAND_HEIGHT?3.5:RUN_SPEED;
    const blend=1-Math.exp(-(len?16:11)*dt);
    p.vx+=(dx*speed-p.vx)*blend;p.vz+=(dz*speed-p.vz)*blend;
  }else if(len){
    // Air control adds only the missing speed along the requested direction.
    // No input means no drag, so slide-jumps keep their carried momentum.
    const oldSpeed=Math.hypot(p.vx,p.vz);
    const add=Math.max(0,Math.min(RUN_SPEED-(p.vx*dx+p.vz*dz),20*dt));
    p.vx+=dx*add;p.vz+=dz*add;
    const newSpeed=Math.hypot(p.vx,p.vz),cap=Math.max(oldSpeed,RUN_SPEED);
    if(newSpeed>cap){p.vx*=cap/newSpeed;p.vz*=cap/newSpeed;}
  }
  if(p.dashWait===0 && p.dashTime===0)p.charge=Math.min(100,p.charge+dt*(Math.hypot(p.vx,p.vz)>3?28:12));
  p.dashReady=previousCharge<100&&p.charge>=100;
  const jumping=!!input.jump&&wasGrounded;
  if(jumping){p.vy=9;p.sliding=false;}
  p.vy-=25*dt;p.grounded=false;
  // Substeps prevent a dash from skipping thin obstacles. Jumping disables stair assistance.
  const canStep=wasGrounded&&!jumping&&p.vy<=0;
  const sub=Math.max(1,Math.ceil(Math.max(Math.abs(p.vx),Math.abs(p.vy),Math.abs(p.vz))*dt/.18));
  for(let i=0;i<sub;i++){
    moveAxis(p,'x',p.vx*dt/sub,boxes,canStep);
    moveAxis(p,'z',p.vz*dt/sub,boxes,canStep);
    moveAxis(p,'y',p.vy*dt/sub,boxes);
    if(p.y<=0){p.y=0;p.vy=0;p.grounded=true;}
  }
  // Follow short downward steps, but allow genuine ledges and jumps to become airborne.
  if(canStep&&!p.grounded){
    let support=0;
    for(const b of boxes){const top=b.y+b.h/2;if(horizontalOverlap(p,b)&&top<=p.y+EPSILON)support=Math.max(support,top);}
    const drop=p.y-support;
    if(drop>=0&&drop<=STEP_HEIGHT){p.y=support;p.vy=0;p.grounded=true;p.stepDelta-=drop;}
  }
  for(const pad of pads){if(p.padWait===0&&p.grounded&&Math.abs(p.x-pad.x)<1.1&&Math.abs(p.z-pad.z)<1.1){p.vy=14;p.grounded=false;p.sliding=false;p.padWait=.8;}}
  if(!p.grounded)p.sliding=false;
  return p;
}
