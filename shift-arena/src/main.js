import { Engine, Scene, Color3, Color4, Vector3, FreeCamera, HemisphericLight, DirectionalLight, MeshBuilder, StandardMaterial, DynamicTexture, TransformNode, Ray, ShadowGenerator } from '@babylonjs/core';
import {stepPlayer} from './physics.js';
import {buildArena,pads,arenaCollisionBoxes,ARENA,SOLO_SPAWN,spawnPlayer,outsideArena,practiceTargets,mapZones,sectorAt} from './arena.js';
import {RoomClient,reconcile} from './network.js';
import {getWeapon,isWeapon,shotDirections} from './combat.js';
import {aimPresentation} from './aim.js';
import {SHIFT_GATES,createShift,stepShift,shiftSnapshot} from './arena-shift.js';
import {createGateViews} from './gates-view.js';
import {createOpponent} from './opponents.js';
import {ROOM_CAPACITY,playerColor} from './multiplayer.js';
import {waitForArena} from './scene-startup.js';
import {viewPolicy,snapCameraToPlayer} from './view-state.js';
const $=id=>document.getElementById(id);
const canvas=$('game');
let engine;
try { engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true}); }
catch(error){$('playText').textContent='WEBGL UNAVAILABLE';$('playNote').textContent='Enable hardware acceleration and reload in a desktop browser.';throw error;}
engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.6));
const scene=new Scene(engine);scene.clearColor=new Color4(.61,.67,.69,1);scene.fogMode=Scene.FOGMODE_LINEAR;scene.fogStart=120;scene.fogEnd=260;scene.fogColor=new Color3(.61,.67,.69);
const camera=new FreeCamera('player',new Vector3(SOLO_SPAWN.x,1.6,SOLO_SPAWN.z),scene);camera.minZ=.06;camera.maxZ=350;camera.fov=Math.PI/2;camera.inputs.clear();
const hemi=new HemisphericLight('sky',new Vector3(0,1,0),scene);hemi.intensity=.85;hemi.groundColor=new Color3(.33,.37,.38);
const sun=new DirectionalLight('sun',new Vector3(-.7,-1,.4),scene);sun.position=new Vector3(45,75,-40);sun.intensity=1.5;sun.diffuse=new Color3(1,.91,.77);
const shadows=new ShadowGenerator(2048,sun);shadows.useBlurExponentialShadowMap=true;shadows.blurKernel=12;shadows.darkness=.25;
function mat(name,color){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=new Color3(.04,.04,.04);return m;}
const concrete=mat('concrete','#9caaa9'),lightConcrete=mat('chalk concrete','#c1c9c3'),dark=mat('charcoal','#424f53'),orange=mat('safety orange','#ee6634'),metal=mat('steel','#657479'),white=mat('ivory','#e2e7db'),cyan=mat('launch pad','#6ed4c4');
const freight=mat('cargo ochre','#bd7446'),cooling=mat('relay teal','#548d91');
cyan.emissiveColor=new Color3(.1,.4,.35);orange.emissiveColor=new Color3(.12,.025,.005);
const gridTexture=new DynamicTexture('floor grid',{width:512,height:512},scene);const gc=gridTexture.getContext();gc.fillStyle='#869594';gc.fillRect(0,0,512,512);gc.strokeStyle='#a5afaa';gc.lineWidth=2;gc.strokeRect(0,0,512,512);gc.strokeStyle='#92a09b';gc.lineWidth=1;gc.beginPath();gc.moveTo(256,0);gc.lineTo(256,512);gc.moveTo(0,256);gc.lineTo(512,256);gc.stroke();gridTexture.update();gridTexture.uScale=30;gridTexture.vScale=30;const groundMat=mat('ground','#d0d4cb');groundMat.diffuseTexture=gridTexture;
const mapBoxes=[];
function box(name,x,y,z,w,h,d,material=concrete,solid=true,cast=true){const m=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);m.position.set(x,y,z);m.material=material;m.receiveShadows=true;if(cast)shadows.addShadowCaster(m);if(solid){const b={x,y,z,w,h,d};if(h>.3)mapBoxes.push(b);}return m;}
buildArena(box,{concrete,lightConcrete,dark,orange,metal,white,cyan,groundMat,freight,cooling});
const gateViews=createGateViews(scene,{panelMaterial:dark,trimMaterial:metal,shadows});
for(const pad of pads){box('pad base',pad.x,.05,pad.z,2.3,.1,2.3,dark,false);box('pad light',pad.x,.115,pad.z,1.9,.03,1.9,cyan,false);for(let i=0;i<3;i++)box('pad marking',pad.x,.14,pad.z-.55+i*.55,1.3,.01,.13,white,false);}
// Floor lane markers and small wayfinding signs.
function sign(text,x,y,z,width,height,rotation=0,background='#253337',foreground='#e3e7dc'){
const texture=new DynamicTexture('sign '+text,{width:1024,height:256},scene);const c=texture.getContext();c.fillStyle=background;c.fillRect(0,0,1024,256);c.fillStyle=foreground;c.font='bold 120px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,138);texture.update();const m=mat('lettering','#ffffff');m.diffuseTexture=texture;m.emissiveColor=new Color3(.16,.16,.16);const p=MeshBuilder.CreatePlane('sign',{width,height},scene);p.position.set(x,y,z);p.rotation.y=rotation;p.material=m;return p;}
sign('SWITCHYARD / 02',0,6,-59.43,20,2.5,Math.PI);sign('SOUTH DEPOT',0,6,59.43,18,2.5);
sign('CONTROL',0,9,9.02,12,2,Math.PI);sign('CONTROL',0,9,-9.02,12,2);
for(const gate of SHIFT_GATES){const y=gate.y+gate.h/2+.3;sign(gate.label+' / TRANSFER',gate.x,y,gate.z+1.51,8,.48,Math.PI);sign(gate.label+' / TRANSFER',gate.x,y,gate.z-1.51,8,.48);}
for(const side of [-1,1]){sign('CARGO / WEST',-40,5,side*1.52,15,1.8,side>0?Math.PI:0,'#72462c');sign('RELAY / EAST',40,5,side*1.52,15,1.8,side>0?Math.PI:0,'#31585f');}
// Distant silhouettes stay beyond the playable perimeter.
for(let i=0;i<12;i++){const x=-90+i*16;box('distant structure',x,8+(i%3)*3,-88-(i%2)*12,10,16+(i%3)*6,12,dark,false,false);}
const targets=[];
function target(x,y,z,rotation=Math.PI){const root=new TransformNode('target assembly',scene);root.position.set(x,y,z);root.rotation.y=rotation;const stem=MeshBuilder.CreateBox('target stand',{width:.13,height:1.2,depth:.13},scene);stem.parent=root;stem.position.y=.6;stem.material=dark;
const plate=MeshBuilder.CreateBox('practice target',{width:1.05,height:1.45,depth:.22},scene);plate.parent=root;plate.position.y=1.65;plate.material=orange;shadows.addShadowCaster(plate);
const ring=MeshBuilder.CreateTorus('bullseye',{diameter:.66,thickness:.07,tessellation:24},scene);ring.parent=root;ring.position.set(0,1.65,-.125);ring.rotation.x=Math.PI/2;ring.material=white;ring.isPickable=false;
const center=MeshBuilder.CreateSphere('bullseye center',{diameter:.15,segments:8},scene);center.parent=root;center.position.set(0,1.65,-.14);center.material=white;center.isPickable=false;
const t={root,plate,ring,center,respawn:0};plate.metadata={target:t};targets.push(t);}
for(const [x,y,z] of practiceTargets)target(x,y,z,z>=0?Math.PI:0);
// Lightweight view model, rendered on top of world geometry.
const weapon=new TransformNode('rifle',scene);weapon.parent=camera;weapon.position.set(.3,-.3,.58);
function gunPart(name,pos,size,m){const p=MeshBuilder.CreateBox(name,{width:size[0],height:size[1],depth:size[2]},scene);p.parent=weapon;p.position.set(...pos);p.material=m;p.isPickable=false;p.renderingGroupId=1;return p;}
gunPart('receiver',[0,0,0],[.15,.16,.42],dark);gunPart('upper',[0,.08,.03],[.11,.07,.4],metal);gunPart('handguard',[0,.015,.3],[.12,.13,.26],dark);gunPart('barrel',[0,.025,.51],[.055,.055,.2],metal);gunPart('magazine',[0,-.15,-.02],[.08,.19,.13],dark);gunPart('stock',[0,-.015,-.3],[.13,.14,.2],dark);gunPart('accent',[.077,0,.04],[.008,.055,.23],orange);gunPart('sight',[0,.155,.02],[.045,.09,.07],dark);gunPart('foregrip',[0,-.1,.24],[.06,.12,.07],dark);gunPart('left glove',[-.05,-.11,.16],[.13,.12,.19],metal);gunPart('right glove',[.025,-.11,-.22],[.13,.12,.19],metal);
const scopeBody=gunPart('sniper optic',[0,.2,-.02],[.105,.1,.32],dark);
const scopeLens=gunPart('sniper lens',[0,.2,.145],[.08,.075,.008],cyan);
const longBarrel=gunPart('sniper barrel',[0,.025,.72],[.055,.055,.42],metal);
const pump=gunPart('shotgun pump',[0,-.035,.29],[.19,.15,.26],orange);
const shellTube=gunPart('shotgun tube',[0,-.06,.5],[.07,.07,.3],metal);
const flash=MeshBuilder.CreateSphere('muzzle flash',{diameter:.15,segments:4},scene);flash.parent=weapon;flash.position.set(0,.025,.65);const flashMat=mat('flash','#ffd89a');flashMat.emissiveColor=new Color3(1,.65,.2);flash.material=flashMat;flash.isPickable=false;flash.renderingGroupId=1;flash.setEnabled(false);weapon.setEnabled(false);
let player=spawnPlayer(),yaw=Math.PI,pitch=0,mode='roam',state='menu',time=0,score=0,shots=0,ammo=30,reloadTime=0,fireWait=0,recoil=0,flashTime=0,hitTime=0,noticeTime=0,elapsed=0,accumulator=0,mouseDown=false,jumpQueued=false,dashQueued=false;
let soloTick=0,soloShift=createShift(),arenaState=shiftSnapshot(soloShift,0),arenaReceivedAt=0,activeBoxes=arenaCollisionBoxes(arenaState),lastShiftCue='';
let soloMode='roam',pausedDeath=false,weaponId='rifle',aimHeld=false,soloHits=0;
let matchState=null,shownRound=-1,lastCountdown=-1;
let combatState=null,reloadQueued=false,damagePulse=0,killFeed=[],tracers=[];
let network=null,networkReady=false,netCorrection=new Vector3(0,0,0);
let stepViewOffset=0,viewHeight=1.62,dashPulse=0,readyPulse=0,deniedPulse=0;
const keys=new Set();let sound=true,sensitivity=1,fov=90,audio;
try{const saved=JSON.parse(localStorage.getItem('shift-settings')||'{}');sensitivity=Number(saved.sensitivity)||1;fov=Number(saved.fov)||90;sound=saved.sound!==false;if(isWeapon(saved.weaponId))weaponId=saved.weaponId;}catch{}
function saveSettings(){try{localStorage.setItem('shift-settings',JSON.stringify({sensitivity,fov,sound,weaponId}));}catch{}}
$('sensitivity').value=sensitivity;$('sensValue').textContent=sensitivity.toFixed(1);$('fov').value=fov;$('fovValue').textContent=fov+'°';$('sound').checked=sound;
function currentWeapon(){return getWeapon(combatState?.weaponId??weaponId);}
function syncLoadout(){
  for(const id of ['loadout','roomLoadout']){$(id).value=weaponId;$(id).disabled=!!network;}
  const sniper=weaponId==='sniper',shotgun=weaponId==='shotgun';
  scopeBody.setEnabled(sniper);scopeLens.setEnabled(sniper);longBarrel.setEnabled(sniper);pump.setEnabled(shotgun);shellTube.setEnabled(shotgun);
  flash.position.z=sniper?.95:.65;
  document.body.classList.toggle('weapon-shotgun',shotgun);
  $('loadoutHint').textContent=network?'Loadout locked for this room. Leave to change it.':sniper?'5 rounds · 90 body / 150 head · hold RMB to scope':shotgun?'6 shells · 8 pellets · strongest at close range':'30 rounds · automatic fire · hold RMB to aim';
}
for(const id of ['loadout','roomLoadout'])$(id).onchange=e=>{if(network||!isWeapon(e.target.value))return;weaponId=e.target.value;syncLoadout();saveSettings();};
syncLoadout();
function clearAim(){aimHeld=false;$('scope').hidden=true;document.body.classList.remove('scoped','aiming');}
function aimState(){return aimPresentation({held:aimHeld,active:state==='active',locked:document.pointerLockElement===canvas,health:combatState?.health??100,reloading:reloadTime>0||reloadQueued,weaponId:currentWeapon().id,baseFov:fov});}
function updateAim(){
  const aim=aimState();if(!aim.aiming)aimHeld=false;
  $('scope').hidden=!aim.scoped;document.body.classList.toggle('scoped',aim.scoped);document.body.classList.toggle('aiming',aim.aiming);
  weapon.setEnabled(state==='active'&&(combatState?.health??100)>0&&!aim.scoped);
}
function beep(freq,duration=.06,volume=.035,fall=0,pan=0){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='triangle';o.frequency.setValueAtTime(freq,audio.currentTime);if(fall)o.frequency.exponentialRampToValueAtTime(fall,audio.currentTime+duration);g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);let stereo;o.connect(g);if(pan&&audio.createStereoPanner){stereo=audio.createStereoPanner();stereo.pan.value=pan;g.connect(stereo);stereo.connect(audio.destination);}else g.connect(audio.destination);o.onended=()=>{o.disconnect();g.disconnect();stereo?.disconnect();};o.start();o.stop(audio.currentTime+duration);}catch{}}
function spatialBeep(source,freq,duration,volume,fall,range=110){
  const dx=source.x-player.x,dz=source.z-player.z,distance=Math.hypot(dx,dz);if(distance>range)return;
  const pan=distance?Math.max(-1,Math.min(1,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/distance)):0;
  beep(freq,duration,volume/(1+distance/12),fall,pan);
}
function notice(message,duration=1.5){$('notice').textContent=message;noticeTime=duration;}
function reset(){if(!network?.id)resetArena();pausedDeath=false;reloadQueued=false;damagePulse=0;killFeed=[];player=spawnPlayer();yaw=Math.PI;pitch=0;time=0;score=0;shots=0;soloHits=0;ammo=currentWeapon().magazine;clearAim();reloadTime=0;fireWait=0;recoil=0;accumulator=0;stepViewOffset=0;viewHeight=1.62;dashPulse=0;readyPulse=0;deniedPulse=0;jumpQueued=false;dashQueued=false;keys.clear();mouseDown=false;for(const t of targets){t.respawn=0;t.root.setEnabled(true);}updateHUD();}
async function lock(){try{await canvas.requestPointerLock();}catch{notice('Click the arena to capture your mouse');}}
function startSolo(){const selected=soloMode;leaveRoom();mode=selected;const url=new URL(location.href);url.searchParams.delete('room');history.replaceState(null,'',url);start();}
function start(){const saved=network?.id?{player:{...player},yaw,pitch}:null;reset();if(saved){player=saved.player;yaw=saved.yaw;pitch=saved.pitch;mode='roam';for(const t of targets)t.root.setEnabled(false);}state='active';document.body.classList.add('playing');$('menu').hidden=true;$('hud').hidden=false;$('pause').hidden=true;$('results').hidden=true;weapon.setEnabled(true);$('modeLabel').textContent=network?.id?'FREE-FOR-ALL':mode==='trial'?'TARGET RUN':'FREE ROAM';$('restartButton').hidden=!!network?.id;$('pauseDescription').textContent=network?.id?'The match keeps running. You can still take damage while paused.':'Your arena is right where you left it.';$('clockLabel').textContent=mode==='trial'?'REMAINING':'SESSION';notice(mode==='trial'?'60 SECONDS. HIT THE ORANGE TARGETS.':'KEEP MOVING. SHIFT TO DASH.',3);if(network?.id&&matchState)applyMatchState(matchState);if(state==='active')lock();}
function pause(){clearAim();if(state!=='active')return;pausedDeath=!!network?.id&&combatState?.health===0;reloadQueued=false;$('scoreboard').hidden=true;network?.pause();state='paused';keys.clear();jumpQueued=false;dashQueued=false;mouseDown=false;$('pause').hidden=false;updateViewState();if(document.pointerLockElement)document.exitPointerLock();}
function resume(){if(!viewPolicy(state,!!network?.id,combatState?.health).canResume)return;if(network?.id){netCorrection.set(0,0,0);stepViewOffset=0;viewHeight=player.height-.13;snapCameraToPlayer(camera,player,yaw,pitch);}pausedDeath=false;state='active';$('pause').hidden=true;weapon.setEnabled(true);updateViewState();lock();}
function lobby(){clearAim();leaveRoom();state='menu';if(document.pointerLockElement)document.exitPointerLock();document.body.classList.remove('playing');$('menu').hidden=false;$('hud').hidden=true;$('pause').hidden=true;$('results').hidden=true;weapon.setEnabled(false);keys.clear();mouseDown=false;}
function complete(){clearAim();state='results';mouseDown=false;keys.clear();document.exitPointerLock();$('results').hidden=false;$('resultScore').textContent=score;$('resultAccuracy').textContent=shots?Math.round(soloHits/shots*100)+'%':'—';beep(660,.2);}
function reload(){if(network?.id&&matchState?.phase!=='active')return;if(reloadTime||ammo===currentWeapon().magazine||state!=='active'||combatState?.health===0)return;clearAim();if(network?.id){reloadQueued=true;beep(240,.1,.02);return;}reloadTime=currentWeapon().reloadTicks/120;beep(240,.1,.02);}
function shoot(){if(network?.id&&matchState?.phase!=='active')return;if(state!=='active'||reloadTime||fireWait>0||combatState?.health===0)return;if(ammo<=0){reload();return;}if(!network?.id){ammo--;shots++;}fireWait=currentWeapon().fireTicks/120;recoil=currentWeapon().recoil;flashTime=.045;flash.setEnabled(true);beep(weaponId==='sniper'?75:weaponId==='shotgun'?90:110,weaponId==='rifle'?.085:.16,.045,35);
if(network?.id)return;
const weaponStats=currentWeapon();let hits=0;
for(const direction of shotDirections(weaponStats,yaw,pitch)){
  const ray=new Ray(camera.globalPosition.clone(),new Vector3(direction.x,direction.y,direction.z),weaponStats.range);
  const pick=scene.pickWithRay(ray,m=>m.isPickable&&m.isEnabled()&&!m.name.startsWith('sign'));
  if(pick?.hit&&pick.pickedMesh?.metadata?.target){const t=pick.pickedMesh.metadata.target;t.root.setEnabled(false);t.respawn=2.8;score++;hits++;}
}
if(hits){soloHits++;hitTime=.15;notice('+'+hits+' TARGET'+(hits>1?'S':''),.7);beep(880,.07,.025);}
if(ammo===0)reload();}
function resetArena(){soloTick=0;soloShift=createShift();lastShiftCue='';applyArenaState(shiftSnapshot(soloShift,0));}
function applyArenaState(next){
  const changed=arenaState.closed.join(',')!==next.closed.join(',');
  arenaState=next;arenaReceivedAt=performance.now();activeBoxes=arenaCollisionBoxes(next);gateViews.update(next,elapsed);
  const cue=next.cycle+':'+next.phase;
  if(cue!==lastShiftCue){
    if(state==='active'){
      if(next.phase==='warning'){notice('ARENA SHIFT IN 5 · '+next.closing.toUpperCase()+' CLOSING',3);beep(330,.25,.03,550);}
      else if(next.phase==='blocked'){notice(next.closing.toUpperCase()+' GATE HELD · CLEAR THE MARKED ZONE',3);beep(220,.15,.025);}
      else if(next.cycle>0){notice('ROUTES SHIFTED · '+(next.closed[0]==='west'?'EAST':'WEST')+' OPEN',3);beep(160,.3,.04,65);}
    }
    lastShiftCue=cue;
  }
  return changed;
}
function updateArenaUI(){
  gateViews.update(arenaState,elapsed);
  const online=!!network?.id,running=!online||matchState?.phase==='active';
  const remaining=online?Math.max(0,arenaState.remaining-(running?(performance.now()-arenaReceivedAt)/1000:0)):Math.max(0,soloShift.nextTick-soloTick)/120;
  const status=$('shiftStatus');status.hidden=state!=='active'||(online&&combatState?.health===0);
  status.classList.toggle('shift-warning',arenaState.phase!=='steady');
  $('gateRoutes').textContent=SHIFT_GATES.map(g=>g.label+' '+(arenaState.closed.includes(g.id)?'CLOSED':'OPEN')).join(' / ');
  $('shiftTimer').textContent=!running?'SHIFTS BEGIN WITH THE ROUND':arenaState.phase==='blocked'?arenaState.closing.toUpperCase()+' HELD · CLEAR THE GATE':arenaState.phase==='warning'?'SHIFT IN '+Math.max(1,Math.ceil(remaining))+' · '+arenaState.closing.toUpperCase()+' CLOSES':'NEXT SHIFT '+Math.ceil(remaining)+'s';
  if(state==='menu')drawMap($('previewMap'));
}
function updateHUD(){$('locationLabel').textContent=sectorAt(player);const duel=!!network?.id;$('weaponLabel').textContent=currentWeapon().label;$('scoreLabel').textContent=duel?'KILLS':'TARGETS';$('healthValue').textContent=duel?(combatState?.health??100):100;$('healthValue').classList.toggle('low-health',duel&&combatState?.health<=25);$('score').textContent=String(duel?(combatState?.kills??0):score).padStart(2,'0');const secs=duel?Math.ceil(matchState?.remaining||0):Math.floor(mode==='trial'?Math.max(0,60-time):time);$('clockLabel').textContent=duel?'ROUND '+(matchState?.round||1):mode==='trial'?'REMAINING':'SESSION';$('clock').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');$('accuracy').textContent=duel?(combatState?.shots?Math.round(combatState.hits/combatState.shots*100)+'%':'—'):(shots?Math.round(soloHits/shots*100)+'%':'—');$('ammo').textContent=String(ammo).padStart(2,'0');$('reloadLabel').textContent=reloadTime?'RELOADING…':'RELOAD';$('dashFill').style.width=player.charge+'%';$('dashText').textContent=player.dashTime>0?'DASHING':player.charge>=100?'READY':player.dashWait>0?'RECOVERING':Math.floor(player.charge)+'%';$('dashStatus').textContent=player.sliding?'SLIDING · STEER YOUR LINE':player.charge>=100?'SHIFT TO DASH':player.dashWait>0?'RECHARGE STARTS SHORTLY':Math.hypot(player.vx,player.vz)>3?'MOVEMENT BOOSTS RECHARGE':'MOVE TO RECHARGE FASTER';$('hud').classList.toggle('dash-ready',player.charge>=100);const speed=Math.hypot(player.vx,player.vz);$('speed').textContent=Math.round(speed);$('speedBars').style.setProperty('--fill',Math.min(100,speed/25*100)+'%');$('hitmarker').style.opacity=hitTime>0?1:0;}
const opponents=new Map();
function clearOpponents(){for(const avatar of opponents.values())avatar.dispose();opponents.clear();}
function updateRemote(dt){
  const remotes=network?.remotes()||[],ids=new Set(remotes.map(p=>p.id));
  for(const [id,avatar] of opponents)if(!ids.has(id)){avatar.dispose();opponents.delete(id);}
  const visible=viewPolicy(state,!!network?.id,combatState?.health).showOpponent;
  for(const remote of remotes){
    if(!opponents.has(remote.id))opponents.set(remote.id,createOpponent(scene,{id:remote.id,slot:remote.slot,materials:{dark,metal,cyan,orange},shadows}));
    const avatar=opponents.get(remote.id);avatar.update(remote,visible,elapsed);
    const p=remote.player,speed=Math.hypot(p.vx,p.vz);
    if(avatar.root.isEnabled()&&p.grounded&&!p.sliding&&speed>2&&elapsed-avatar.lastStepAt>.32){avatar.lastStepAt=elapsed;spatialBeep(p,95,.035,.025,60,32);}
  }
  if(network?.id)$('networkHud').textContent='ROOM '+network.code+' · '+network.players.length+'/'+ROOM_CAPACITY+' · '+network.rtt+' MS';
}
function updateScoreboard(){
  const body=$('scoreRows');body.replaceChildren();
  for(const p of [...(network?.players||[])].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths)){
    const row=document.createElement('tr');if(p.id===network.id)row.classList.add('you');row.style.borderLeft='3px solid '+playerColor(p.slot);
    for(const value of [p.name+(p.id===network.id?' (YOU)':''),p.kills,p.deaths,p.health===0?'RESPAWNING':!p.entered?'WAITING':p.paused?'PAUSED':'IN ARENA']){const cell=document.createElement('td');cell.textContent=String(value);row.appendChild(cell);}body.appendChild(row);
  }
}
function handleCombatEvent(event){
  if(event.kind!=='shot')return;
  const own=event.shooter===network.id;
  if(!own&&viewPolicy(state,!!network?.id,combatState?.health).showOpponent){
    for(const end of event.pellets||[event.to]){const line=MeshBuilder.CreateLines('shot tracer',{points:[new Vector3(event.from.x,event.from.y,event.from.z),new Vector3(end.x,end.y,end.z)]},scene);line.color=new Color3(1,.7,.35);line.isPickable=false;tracers.push({mesh:line,ttl:.09});}
    if(state==='active')spatialBeep(event.from,event.weaponId==='sniper'?75:145,.1,.045,55);
  }
  const impacts=event.impacts||[event].filter(hit=>hit.target);
  if(own&&impacts.length){
    const kills=impacts.filter(hit=>hit.killed).length,damage=impacts.reduce((sum,hit)=>sum+hit.damage,0),headshot=impacts.some(hit=>hit.headshot);
    hitTime=.18;notice(kills>1?'MULTI KILL · '+kills:kills?'ELIMINATED':(headshot?'HEADSHOT · ':'HIT · ')+damage,.9);beep(kills?1100:headshot?960:760,.08,.03);
  }
  for(const hit of impacts){
    if(hit.target===network.id){damagePulse=1;if(!hit.killed)beep(150,.12,.035,70);}
    if(hit.killed){const name=id=>network.players.find(p=>p.id===id)?.name||'Runner';killFeed.push({text:name(event.shooter)+' → '+name(hit.target)+(hit.headshot?' · HEADSHOT':''),until:elapsed+6});}
  }
  killFeed=killFeed.slice(-5);
}

function updateViewState(){
  const policy=viewPolicy(state,!!network?.id,combatState?.health);
  document.body.classList.toggle('view-blocked',policy.hideArena);
  $('resumeButton').disabled=!policy.canResume;
  if(state==='paused'&&network?.id){
    if(combatState?.health===0){pausedDeath=true;$('pauseDescription').textContent='You were eliminated. Respawning in '+Math.max(1,Math.ceil(combatState.respawnRemaining))+'…';}
    else $('pauseDescription').textContent=pausedDeath?'You have respawned. Resume to play from your new position.':'The match keeps running. You can still take damage while paused.';
  }
}
function updateCombatEffects(dt){
  damagePulse=Math.max(0,damagePulse-dt*1.8);$('damageEffect').style.opacity=damagePulse*.75;
  for(let i=tracers.length-1;i>=0;i--){tracers[i].ttl-=dt;if(tracers[i].ttl<=0){tracers[i].mesh.dispose();tracers.splice(i,1);}}
  killFeed=killFeed.filter(f=>f.until>elapsed);$('killFeed').textContent=killFeed.map(f=>f.text).join('\n');
  const dead=!!network?.id&&matchState?.phase==='active'&&combatState?.health===0;
  $('deathOverlay').hidden=!dead||state!=='active';
  if(dead)$('respawnCountdown').textContent=Math.max(1,Math.ceil(combatState.respawnRemaining));
  $('spawnProtection').hidden=!network?.id||matchState?.phase!=='active'||!combatState?.entered||combatState.shieldRemaining<=0||dead;
}
function applyMatchState(match){
  const previous=matchState?.phase;matchState=match;if(match.phase==='countdown'&&previous!=='countdown'){killFeed=[];damagePulse=0;mouseDown=false;reloadQueued=false;}
  const active=state==='active'||state==='paused';
  $('roundStatus').hidden=!network?.id||!active||match.phase==='active';
  $('roundStatus').textContent=match.phase==='waiting'?'WAITING FOR 2 PLAYERS TO ENTER · EXPLORE THE ARENA':match.phase==='countdown'?'ROUND '+match.round+' STARTS IN '+Math.max(1,Math.ceil(match.countdown)):'REMATCH READY '+match.ready.length+'/'+(match.entered?.length||2)+' · WAITING FOR ALL ACTIVE PLAYERS';
  const count=Math.ceil(match.countdown);
  if(match.phase==='countdown'&&count!==lastCountdown){lastCountdown=count;if(active)beep(420,.08,.025);}
  if(match.phase==='active'&&previous==='countdown'){lastCountdown=-1;mouseDown=false;notice('ROUND '+match.round+' · GO!',2);beep(900,.15,.03);}
  if(match.phase==='ended'&&state!=='menu'&&shownRound!==match.round){
    shownRound=match.round;state='matchResults';mouseDown=false;keys.clear();jumpQueued=false;dashQueued=false;reloadQueued=false;network.pause();
    $('pause').hidden=true;$('scoreboard').hidden=true;$('deathOverlay').hidden=true;$('roundStatus').hidden=true;$('matchResults').hidden=false;weapon.setEnabled(false);
    if(document.pointerLockElement)document.exitPointerLock();
    const result=match.result,participated=result?.standings.some(p=>p.id===network.id);
    $('matchTitle').textContent=!participated?'ROUND COMPLETE.':!result.winnerId?'A DRAW.':result.winnerId===network.id?'VICTORY.':'NEXT TIME.';
    $('matchReason').textContent=result.reason==='forfeit'?'Only one player remains. Invite more players or request a rematch.':'Time is up. Five minutes, every angle contested.';
    const rows=$('matchRows');rows.replaceChildren();
    for(const p of result.standings){const row=document.createElement('tr');for(const value of [p.name,p.kills,p.deaths]){const cell=document.createElement('td');cell.textContent=String(value);row.appendChild(cell);}rows.appendChild(row);}
  }
}
$('rematchButton').onclick=()=>{
  if(!network?.id||matchState?.phase!=='ended')return;
  network.send({type:'ready',round:matchState.round});$('matchResults').hidden=true;state='active';mouseDown=false;keys.clear();applyMatchState(matchState);lock();
};
$('matchLeave').onclick=lobby;
function leaveRoom(){clearAim();pausedDeath=false;document.body.classList.remove('view-blocked');$('resumeButton').disabled=false;network?.close();network=null;matchState=null;resetArena();shownRound=-1;lastCountdown=-1;$('matchResults').hidden=true;$('roundStatus').hidden=true;combatState=null;reloadQueued=false;damagePulse=0;killFeed=[];for(const t of tracers)t.mesh.dispose();tracers=[];$('deathOverlay').hidden=true;$('scoreboard').hidden=true;$('spawnProtection').hidden=true;for(const t of targets)t.root.setEnabled(true);netCorrection.set(0,0,0);clearOpponents();$('networkHud').hidden=true;$('roomJoined').hidden=true;$('roomForm').hidden=false;$('roomDialog').hidden=true;$('roomOpen').textContent='PLAY WITH FRIENDS ↗';$('restartButton').hidden=false;syncLoadout();}
function roomStatus(message){$('roomStatus').textContent=message;}
function updateRoomStatus(){if(!network?.id)return;$('roomCodeDisplay').textContent=network.code;$('roomPlayers').textContent=network.players.map(p=>p.name).join(' + ')+' · '+network.players.length+'/'+ROOM_CAPACITY;$('networkHud').textContent='ROOM '+network.code+' · '+network.players.length+'/'+ROOM_CAPACITY+' · '+network.rtt+' MS';}
async function connectRoom(action){
  if(!networkReady)return;
  $('createRoom').disabled=true;$('joinRoom').disabled=true;for(const id of ['loadout','roomLoadout'])$(id).disabled=true;roomStatus('CONNECTING…');
  const client=new RoomClient({onState(message){
    if(network!==client)return;
    const gatesChanged=message.arena?applyArenaState(message.arena):false;
    if(message.match)applyMatchState(message.match);
    const self=message.players.find(p=>p.id===client.id);
    if(self){
      const oldLife=combatState?.life,wasAlive=(combatState?.health??100)>0,previous=player;combatState=self;ammo=self.ammo;reloadTime=self.reloadRemaining;
      if(self.health===0){player={...self.player};client.pending=client.pending.filter(f=>f.seq>self.ack);mouseDown=false;jumpQueued=false;dashQueued=false;reloadQueued=false;}
      else {
        client.pending=client.pending.filter(f=>f.life===undefined||f.life===self.life);
        const result=reconcile(self.player,client.pending,self.ack,activeBoxes);player=result.player;client.pending=result.pending;
        if(oldLife!==undefined&&oldLife!==self.life){
          yaw=self.yaw;pitch=self.pitch;stepViewOffset=0;viewHeight=player.height-.13;netCorrection.set(0,0,0);accumulator=0;mouseDown=false;reloadQueued=false;fireWait=0;notice(matchState?.phase==='countdown'?'ROUND '+matchState.round:'BACK IN. MAKE IT COUNT.',2);
        }else if(gatesChanged){netCorrection.set(0,0,0);stepViewOffset=0;snapCameraToPlayer(camera,player,yaw,pitch);
        }else if(state==='active'){const dx=previous.x-player.x,dz=previous.z-player.z;if(Math.hypot(dx,dz)<2){netCorrection.x=Math.max(-2,Math.min(2,netCorrection.x+dx));netCorrection.z=Math.max(-2,Math.min(2,netCorrection.z+dz));}else netCorrection.set(0,0,0);}
      }
      if(wasAlive&&self.health===0){beep(110,.3,.04,40);$('scoreboard').hidden=true;}
      if(viewPolicy(state,true,self.health).followSnapshot||oldLife!==self.life)snapCameraToPlayer(camera,player,yaw,pitch);
      updateViewState();weapon.setEnabled(state==='active'&&self.health>0);updateHUD();updateScoreboard();
    }
    updateRoomStatus();
  },onEvent(event){if(network===client)handleCombatEvent(event);},onClose(){if(network!==client)return;lobby();$('roomDialog').hidden=false;roomStatus('Connection lost. Create or join a room to reconnect.');}});
  network=client;
  try{const joined=await client.connect(action,$('playerName').value.trim()||'Runner',$('roomCode').value.trim().toUpperCase(),weaponId);
    if(network!==client)return;
    matchState=joined.match;if(joined.arena)applyArenaState(joined.arena);player={...joined.player};combatState=joined.players.find(p=>p.id===joined.id);yaw=combatState?.yaw??Math.PI;pitch=0;mode='roam';$('roomForm').hidden=true;$('roomJoined').hidden=false;$('networkHud').hidden=false;$('roomOpen').textContent='ROOM '+client.code+' ↗';syncLoadout();updateRoomStatus();roomStatus('Share the invite. Enter when ready—the match starts with two players. Others can join during the round.');
  }catch(error){if(network===client){client.close();network=null;roomStatus(error.message);}}
  finally{syncLoadout();$('createRoom').disabled=!networkReady;$('joinRoom').disabled=!networkReady;}
}
function setupRooms(){
  $('roomOpen').onclick=()=>{$('roomDialog').hidden=false;};$('closeRoom').onclick=()=>{if(network&&!network.id)leaveRoom();$('roomDialog').hidden=true;};
  $('createRoom').onclick=()=>connectRoom('create');$('joinRoom').onclick=()=>connectRoom('join');$('roomEnter').onclick=()=>{$('roomDialog').hidden=true;start();};$('leaveRoom').onclick=()=>{leaveRoom();$('roomDialog').hidden=false;roomStatus('Room left.');};
  $('copyInvite').onclick=async()=>{if(!network?.id)return;const url=new URL(location.href);url.searchParams.set('room',network.code);$('inviteUrl').value=url.href;$('inviteUrl').hidden=false;try{await navigator.clipboard.writeText(url.href);roomStatus('Invite link copied.');}catch{$('inviteUrl').select();roomStatus('Copy the invite link below.');}};
  const invited=new URLSearchParams(location.search).get('room');if(invited){$('roomCode').value=invited.slice(0,8).toUpperCase();$('roomDialog').hidden=false;}
  fetch('/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(data=>{networkReady=data.multiplayer===true;$('createRoom').disabled=!networkReady;$('joinRoom').disabled=!networkReady;roomStatus(networkReady?'2–4 players. Share a room code, then enter the arena.':'Private rooms are not available on this host yet.');}).catch(()=>{roomStatus('Private rooms are not available on this host yet. Solo practice is ready to play.');});
}
function drawMap(canvas,p=null){const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,scale=Math.min(w,h)/ARENA.mapExtent,ox=w/2,oy=h/2;c.clearRect(0,0,w,h);c.strokeStyle='#7a919025';c.lineWidth=1;for(let x=-ARENA.halfSize;x<=ARENA.halfSize;x+=12){c.beginPath();c.moveTo(ox+x*scale,oy-ARENA.halfSize*scale);c.lineTo(ox+x*scale,oy+ARENA.halfSize*scale);c.stroke();c.beginPath();c.moveTo(ox-ARENA.halfSize*scale,oy+x*scale);c.lineTo(ox+ARENA.halfSize*scale,oy+x*scale);c.stroke();}for(const b of mapBoxes){c.fillStyle=b.h>5?'#899c9770':'#899c9740';c.fillRect(ox+(b.x-b.w/2)*scale,oy+(b.z-b.d/2)*scale,b.w*scale,b.d*scale);c.strokeStyle='#c5d1c140';c.strokeRect(ox+(b.x-b.w/2)*scale,oy+(b.z-b.d/2)*scale,b.w*scale,b.d*scale);}for(const gate of SHIFT_GATES){const changing=arenaState.phase!=='steady'&&(arenaState.closing===gate.id||arenaState.opening===gate.id);c.strokeStyle=changing?'#ffbd60':arenaState.closed.includes(gate.id)?'#ff754d':'#70e4c7';c.lineWidth=3;c.setLineDash(arenaState.closed.includes(gate.id)?[]:[3,3]);c.beginPath();c.moveTo(ox+(gate.x-gate.w/2)*scale,oy+gate.z*scale);c.lineTo(ox+(gate.x+gate.w/2)*scale,oy+gate.z*scale);c.stroke();c.setLineDash([]);c.lineWidth=1;}for(const t of targets){if(t.respawn||network?.id)continue;c.fillStyle='#ff8750';c.fillRect(ox+t.root.position.x*scale-2,oy+t.root.position.z*scale-2,4,4);}for(const pad of pads){c.fillStyle='#73cfc2';c.fillRect(ox+pad.x*scale-3,oy+pad.z*scale-3,6,6);}if(p)for(const avatar of opponents.values())if(avatar.root.isEnabled()){c.fillStyle=avatar.color;c.beginPath();c.arc(ox+avatar.root.position.x*scale,oy+avatar.root.position.z*scale,3,0,Math.PI*2);c.fill();}if(!p){c.textAlign='center';c.font='9px monospace';c.fillStyle='#c4dbd5';for(const zone of mapZones)c.fillText(zone.label,ox+zone.x*scale,oy+zone.z*scale);}const pos=p||SOLO_SPAWN;c.save();c.translate(ox+pos.x*scale,oy+pos.z*scale);c.rotate(p?-yaw:Math.PI);c.fillStyle='#f4f2dd';c.beginPath();c.moveTo(0,6);c.lineTo(-4,-4);c.lineTo(0,-2);c.lineTo(4,-4);c.closePath();c.fill();c.restore();}
drawMap($('previewMap'));
setupRooms();
$('playButton').onclick=startSolo;$('resumeButton').onclick=resume;$('restartButton').onclick=startSolo;$('exitButton').onclick=lobby;$('againButton').onclick=startSolo;$('resultsExit').onclick=lobby;
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{soloMode=mode=b.dataset.mode;for(const other of document.querySelectorAll('[data-mode]'))other.classList.toggle('selected',other===b);};
$('settingsButton').onclick=()=>{$('settings').hidden=false;};$('closeSettings').onclick=()=>{$('settings').hidden=true;saveSettings();};
$('sensitivity').oninput=e=>{sensitivity=+e.target.value;$('sensValue').textContent=sensitivity.toFixed(1);};$('fov').oninput=e=>{fov=+e.target.value;$('fovValue').textContent=fov+'°';};$('sound').onchange=e=>{sound=e.target.checked;};
document.addEventListener('keydown',e=>{if(state!=='active')return;if(['Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD','KeyC','KeyR','Tab'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Tab'&&network?.id){updateScoreboard();$('scoreboard').hidden=false;}if(e.code==='Space'&&!e.repeat)jumpQueued=true;if(e.code.startsWith('Shift')&&!e.repeat)dashQueued=true;if(e.code==='KeyR')reload();if(e.code==='Escape')pause();});
document.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Tab')$('scoreboard').hidden=true;});document.addEventListener('mousemove',e=>{if(state==='active'&&document.pointerLockElement===canvas){const aimScale=aimState().sensitivity;yaw+=e.movementX*.002*sensitivity*aimScale;pitch=Math.max(-1.45,Math.min(1.45,pitch+e.movementY*.002*sensitivity*aimScale));}});
canvas.addEventListener('mousedown',e=>{if(state==='active'){if(document.pointerLockElement!==canvas){lock();return;}if(e.button===0)mouseDown=true;if(e.button===2){e.preventDefault();aimHeld=true;}}});document.addEventListener('mouseup',e=>{if(e.button===0)mouseDown=false;if(e.button===2)clearAim();});canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&state==='active')pause();});document.addEventListener('pointerlockerror',()=>{if(state==='active')pause();});window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('resize',()=>engine.resize());
waitForArena(scene,{
  onReady(){ $('playButton').disabled=false;$('playText').textContent='PLAY SOLO';$('playButton').onclick=startSolo;$('playNote').textContent='SOLO PRACTICE • NO BOTS • KEYBOARD & MOUSE'; },
  onStalled(){ $('playButton').disabled=false;$('playText').textContent='RETRY LOADING';$('playButton').onclick=()=>location.reload();$('playNote').textContent='Arena initialization stalled. Click to reload.';console.error('Arena startup stalled',{pendingTextures:scene.textures.filter(t=>!t.isReady()).map(t=>t.name)}); }
});
let uiTimer=0;
engine.runRenderLoop(()=>{const dt=Math.min(engine.getDeltaTime()/1000,.05);elapsed+=dt;
if(state==='menu'){const a=elapsed*.025;camera.position.set(88*Math.cos(a+.7),62,88*Math.sin(a+.7));camera.setTarget(new Vector3(0,2,0));camera.fov=1.05;}
if(state==='active'){
time+=dt;accumulator+=dt;while(accumulator>=1/120){
const alive=!network?.id||(combatState?.health>0&&(matchState?.phase==='waiting'||matchState?.phase==='active'));
const canFire=!network?.id||matchState?.phase==='active';
const movementInput={right:alive?((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)):0,forward:alive?((keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)):0,yaw,jump:alive&&jumpQueued,dash:alive&&dashQueued,slide:alive&&keys.has('KeyC'),pitch,fire:alive&&canFire&&mouseDown,reload:alive&&canFire&&reloadQueued,life:combatState?.life??0,viewTick:network?.viewTick()??0};
if(!network?.id){soloTick++;if(stepShift(soloShift,soloTick,[player]))applyArenaState(shiftSnapshot(soloShift,soloTick));}
if(alive){stepPlayer(player,movementInput,1/120,activeBoxes,pads);stepViewOffset-=player.stepDelta;if(player.dashStarted){dashPulse=1;beep(280,.18,.045,55);}if(player.dashReady){readyPulse=1;beep(740,.12,.025,1100);}if(player.dashDenied){deniedPulse=1;beep(95,.06,.015,70);}}
network?.input(movementInput);jumpQueued=false;dashQueued=false;reloadQueued=false;accumulator-=1/120;
}
if(outsideArena(player))player=spawnPlayer();
const speed=Math.hypot(player.vx,player.vz),bob=player.grounded&&!player.sliding?Math.sin(time*speed*1.65)*.025:0;
stepViewOffset*=Math.exp(-16*dt);viewHeight+=(player.height-.13-viewHeight)*(1-Math.exp(-20*dt));
let eyeY=player.y+viewHeight+stepViewOffset+bob;
// Smooth the view independently of collision, while keeping the eye below nearby ceilings.
for(const b of activeBoxes){const bottom=b.y-b.h/2;if(bottom>player.y+.1&&Math.abs(player.x-b.x)<b.w/2+.08&&Math.abs(player.z-b.z)<b.d/2+.08)eyeY=Math.min(eyeY,bottom-.1);}
eyeY=Math.max(player.y+.15,eyeY);
netCorrection.scaleInPlace(Math.exp(-14*dt));camera.position.set(player.x+netCorrection.x,eyeY,player.z+netCorrection.z);camera.rotation.set(pitch,yaw,0);camera.fov+=(aimState().fov*Math.PI/180+(!aimState().aiming&&player.dashTime>0?.09:0)-camera.fov)*Math.min(1,dt*8);
dashPulse=Math.max(0,dashPulse-dt*4);readyPulse=Math.max(0,readyPulse-dt*1.8);deniedPulse=Math.max(0,deniedPulse-dt*4);
$('dashEffect').style.opacity=dashPulse*.65;$('hud').style.setProperty('--ready-pulse',readyPulse);$('hud').style.setProperty('--denied-pulse',deniedPulse);
fireWait=Math.max(0,fireWait-dt);if(reloadTime>0&&!network?.id){reloadTime-=dt;if(reloadTime<=0){reloadTime=0;ammo=currentWeapon().magazine;beep(420,.05,.02);}}if(mouseDown)shoot();
recoil=Math.max(0,recoil-dt*.25);weapon.position.set((aimState().aiming?.07:.3)+Math.sin(time*8)*speed*.0006,-.3+bob*.6-(reloadTime?Math.sin(reloadTime/(currentWeapon().reloadTicks/120)*Math.PI)*.23:0),.58-recoil);weapon.rotation.x=-recoil*1.5;weapon.rotation.z+=((player.sliding?-.16:player.height<1.5?-.06:0)-weapon.rotation.z)*Math.min(1,dt*12);
flashTime-=dt;if(flashTime<=0)flash.setEnabled(false);hitTime-=dt;noticeTime-=dt;if(noticeTime<=0)$('notice').textContent='';for(const t of targets)if(t.respawn>0){t.respawn-=dt;if(t.respawn<=0){t.respawn=0;t.root.setEnabled(true);}}
if(mode==='trial'&&time>=60)complete();
uiTimer+=dt;if(uiTimer>.06){uiTimer=0;updateHUD();drawMap($('minimap'),player);$('fps').textContent=Math.round(engine.getFps())+' FPS';}
}
updateViewState();
updateArenaUI();
updateAim();
updateRemote(dt);
updateCombatEffects(dt);
scene.render();
});
