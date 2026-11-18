import {randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {stepPlayer} from '../src/physics.js';
import {arenaCollisionBoxes,pads,SPAWNS,spawnPlayer,outsideArena} from '../src/arena.js';
import {RIFLE,getWeapon,isWeapon,shotDirections,shotDamage,traceShot} from '../src/combat.js';
import {createShift,stepShift,shiftSnapshot,SHIFT_INTERVAL_TICKS,SHIFT_WARNING_TICKS} from '../src/arena-shift.js';
import {ROOM_CAPACITY} from '../src/multiplayer.js';
import {chooseSpawn} from './spawns.js';
export const TICK=1/120;
export class RoomHub {
  constructor({roundTicks=5*60*120,countdownTicks=3*120,shiftIntervalTicks=SHIFT_INTERVAL_TICKS,shiftWarningTicks=SHIFT_WARNING_TICKS}={}){this.shiftOptions={intervalTicks:shiftIntervalTicks,warningTicks:shiftWarningTicks};this.roundTicks=roundTicks;this.countdownTicks=countdownTicks;this.rooms=new Map();this.peers=new Set();this.tick=0;}
  send(peer,data){if(peer.socket.readyState===1){if(peer.socket.bufferedAmount>262144){peer.socket.close(1008,'Connection too slow');return;}peer.socket.send(JSON.stringify(data));}}
  add(socket){
    const peer={socket,id:randomUUID(),room:null,queue:[],seq:0,ack:0,player:null,yaw:Math.PI,pitch:0,name:'',lastSeen:performance.now(),window:performance.now(),messages:0,frames:0,paused:true,entered:false,health:100,weaponId:'rifle',ammo:RIFLE.magazine,reloadUntil:0,nextShot:0,respawnAt:0,shieldUntil:0,life:0,kills:0,deaths:0,shots:0,hits:0,history:[]};
    this.peers.add(peer);
    socket.on('message',raw=>{try{this.receive(peer,JSON.parse(raw.toString()));}catch{socket.close(1008,'Invalid message');}});
    socket.on('error',()=>{});socket.on('close',()=>this.remove(peer));
    return peer;
  }
  receive(peer,m){
    const now=performance.now();peer.lastSeen=now;
    if(now-peer.window>=1000){peer.window=now;peer.messages=0;peer.frames=0;}
    if(++peer.messages>180)throw Error('Message limit');
    if(!m||typeof m!=='object')throw Error('Invalid message');
    if(m.type==='ping'){this.send(peer,{type:'pong',at:m.at});return;}
    if(m.type==='create'||m.type==='join'){
      if(peer.room)throw Error('Already joined');
      if(typeof m.name!=='string'||m.name.length>24)throw Error('Invalid name');
      if(m.weaponId!==undefined&&!isWeapon(m.weaponId))throw Error('Invalid weapon');
      peer.weaponId=m.weaponId??'rifle';peer.ammo=getWeapon(peer.weaponId).magazine;
      peer.name=m.name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,16)||'Runner';
      let room;
      if(m.type==='create'){
        if(this.rooms.size>=100){this.send(peer,{type:'error',message:'The server is full. Try again shortly.'});return;}
        let code;do{code=randomBytes(4).toString('hex').toUpperCase();}while(this.rooms.has(code));
        room={code,players:new Map(),phase:'waiting',round:0,startTick:0,endTick:0,result:null,ready:new Set(),arena:createShift(this.tick,this.shiftOptions),arenaTick:this.tick};this.rooms.set(code,room);
      }else{
        const code=String(m.code||'').toUpperCase();room=this.rooms.get(code);
        if(!room){this.send(peer,{type:'error',message:'Room not found. Check the code or ask for a new invite.'});return;}
        if(room.players.size>=ROOM_CAPACITY){this.send(peer,{type:'error',message:'That room already has four players.'});return;}
      }
      const slot=Array.from({length:ROOM_CAPACITY},(_,i)=>i).find(i=>![...room.players.values()].some(p=>p.slot===i));
      peer.slot=slot;peer.player=spawnPlayer(SPAWNS[slot]);peer.yaw=Math.atan2(-peer.player.x,-peer.player.z);
      peer.room=room;room.players.set(peer.id,peer);
      if(room.phase==='active'){peer.player=spawnPlayer(chooseSpawn(peer,[...room.players.values()],arenaCollisionBoxes(room.arena)));peer.yaw=Math.atan2(-peer.player.x,-peer.player.z);}
      this.send(peer,{type:'joined',id:peer.id,code:room.code,player:peer.player,players:this.snapshot(room),match:this.matchSnapshot(room),arena:shiftSnapshot(room.arena,room.arenaTick)});
      this.broadcast(room);return;
    }
    if(!peer.room)throw Error('Join a room first');
    if(m.type==='ready'){
      const room=peer.room;
      if(!Number.isSafeInteger(m.round)||m.round!==room.round||room.phase!=='ended')return;
      room.ready.add(peer.id);peer.entered=true;this.broadcast(room);return;
    }
    if(m.type==='pause'){
      peer.paused=true;peer.queue=[];peer.ack=peer.seq;this.broadcast(peer.room);return;
    }
    if(m.type==='input'){
      if(!Array.isArray(m.frames)||m.frames.length<1||m.frames.length>12)throw Error('Invalid inputs');
      peer.frames+=m.frames.length;if(peer.frames>160||peer.queue.length+m.frames.length>240)throw Error('Input limit');
      for(const f of m.frames){
        if(!Number.isSafeInteger(f.seq)||f.seq!==peer.seq+1||![-1,0,1].includes(f.forward)||![-1,0,1].includes(f.right)||!Number.isFinite(f.yaw)||Math.abs(f.yaw)>1e6||!Number.isFinite(f.pitch)||Math.abs(f.pitch)>1.5||typeof f.slide!=='boolean'||typeof f.jump!=='boolean'||typeof f.dash!=='boolean')throw Error('Invalid input');
        if((f.fire!==undefined&&typeof f.fire!=='boolean')||(f.reload!==undefined&&typeof f.reload!=='boolean')||(f.viewTick!==undefined&&(!Number.isSafeInteger(f.viewTick)||f.viewTick<0))||(f.life!==undefined&&(!Number.isSafeInteger(f.life)||f.life<0)))throw Error('Invalid combat input');
        peer.seq=f.seq;peer.queue.push({seq:f.seq,forward:f.forward,right:f.right,yaw:f.yaw,pitch:f.pitch,slide:f.slide,jump:f.jump,dash:f.dash,fire:f.fire===true,reload:f.reload===true,viewTick:f.viewTick,life:f.life??peer.life});
      }
      if(!peer.entered){peer.entered=true;if(peer.room.phase==='active'||peer.room.phase==='countdown')this.respawn(peer);peer.shieldUntil=Math.max(this.tick,peer.room.phase==='countdown'?peer.room.startTick:0)+RIFLE.shieldTicks;}peer.paused=false;return;
    }
    throw Error('Unknown message');
  }
  matchSnapshot(room){return {phase:room.phase,round:room.round,remaining:room.phase==='active'?Math.max(0,room.endTick-this.tick)/120:0,countdown:room.phase==='countdown'?Math.max(0,room.startTick-this.tick)/120:0,result:room.result,ready:[...room.ready],entered:[...room.players.values()].filter(p=>p.entered).map(p=>p.id),capacity:ROOM_CAPACITY};}
  beginRound(room){
    room.round++;room.phase='countdown';room.startTick=this.tick+this.countdownTicks;room.endTick=room.startTick+this.roundTicks;room.result=null;room.ready.clear();room.arena=createShift(room.startTick,this.shiftOptions);room.arenaTick=room.startTick;
    for(const p of room.players.values()){p.kills=0;p.deaths=0;p.shots=0;p.hits=0;this.respawn(p);p.shieldUntil=room.startTick+RIFLE.shieldTicks;}
    this.broadcast(room);
  }
  endRound(room,reason='time',winnerId=null){
    if(room.phase!=='active')return;
    const standings=[...room.players.values()].filter(p=>p.entered).map(p=>({id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,shots:p.shots,hits:p.hits})).sort((a,b)=>b.kills-a.kills);
    if(reason==='time'&&standings.length>1&&standings[0].kills!==standings[1].kills)winnerId=standings[0].id;
    room.result={reason,winnerId,standings};room.phase='ended';room.ready.clear();
    for(const p of room.players.values()){p.queue=[];p.ack=p.seq;p.reloadUntil=0;p.respawnAt=0;p.player.vx=0;p.player.vy=0;p.player.vz=0;}
    this.broadcast(room);
  }
  snapshot(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name,slot:p.slot,ack:p.ack,yaw:p.yaw,pitch:p.pitch,paused:p.paused,entered:p.entered,player:{...p.player},health:p.health,weaponId:p.weaponId,ammo:p.ammo,reloadRemaining:Math.max(0,p.reloadUntil-this.tick)/120,respawnRemaining:Math.max(0,p.respawnAt-this.tick)/120,shieldRemaining:Math.max(0,p.shieldUntil-this.tick)/120,life:p.life,kills:p.kills,deaths:p.deaths,shots:p.shots,hits:p.hits}));}
  event(room,event){for(const p of room.players.values())this.send(p,{type:'event',tick:this.tick,...event});}
  respawn(peer){
    peer.player=spawnPlayer(chooseSpawn(peer,[...peer.room.players.values()],arenaCollisionBoxes(peer.room.arena)));peer.yaw=Math.atan2(-peer.player.x,-peer.player.z);peer.pitch=0;
    peer.health=100;peer.ammo=getWeapon(peer.weaponId).magazine;peer.reloadUntil=0;peer.respawnAt=0;peer.shieldUntil=this.tick+RIFLE.shieldTicks;peer.nextShot=this.tick;peer.life++;
    peer.queue=[];peer.ack=peer.seq;peer.history=[];peer.lastInput=null;
    this.event(peer.room,{kind:'respawn',id:peer.id});
  }
  fire(peer,input){
    if(peer.room.phase!=='active'||!peer.entered||peer.health<=0||peer.reloadUntil||this.tick<peer.nextShot||input.life!==peer.life)return;
    const weapon=getWeapon(peer.weaponId);
    if(peer.ammo<=0){peer.reloadUntil=this.tick+weapon.reloadTicks;return;}
    peer.ammo--;peer.shots++;peer.nextShot=this.tick+weapon.fireTicks;peer.shieldUntil=0;
    const origin={x:peer.player.x,y:peer.player.y+peer.player.height-.13,z:peer.player.z};
    const viewTick=Math.max(this.tick-RIFLE.maxRewindTicks,Math.min(this.tick,input.viewTick??this.tick));
    const opponents=[];
    for(const other of peer.room.players.values()){
      if(other===peer||!other.entered||other.health<=0||other.shieldUntil>this.tick)continue;
      const past=[...other.history].reverse().find(s=>s.tick<=viewTick)||other.history[0];
      // A prior life's position cannot be hit after its replacement has spawned.
      if(past&&past.life===other.life&&past.health>0)opponents.push({id:other.id,player:past.player});
    }
    const obstacles=arenaCollisionBoxes(peer.room.arena);
    const pellets=shotDirections(weapon,peer.yaw,peer.pitch).map(direction=>traceShot(origin,direction,obstacles,opponents,weapon.range));
    const impacts=[];
    for(const target of new Set(pellets.map(p=>p.target).filter(Boolean))){
      const victim=peer.room.players.get(target),hits=pellets.filter(p=>p.target===target);
      const damage=hits.reduce((total,p)=>total+shotDamage(weapon,p),0),headshot=hits.some(p=>p.headshot);
      victim.health=Math.max(0,victim.health-damage);const killed=victim.health===0;
      if(killed){peer.kills++;victim.deaths++;victim.respawnAt=this.tick+RIFLE.respawnTicks;victim.reloadUntil=0;victim.player.vx=0;victim.player.vy=0;victim.player.vz=0;}
      impacts.push({target,headshot,damage,killed});
    }
    if(impacts.length)peer.hits++;
    const first=impacts[0]||{target:null,headshot:false,damage:0,killed:false};
    this.event(peer.room,{kind:'shot',weaponId:peer.weaponId,shooter:peer.id,from:origin,to:pellets[0].to,pellets:pellets.map(p=>p.to),impacts,...first});
    if(peer.ammo===0)peer.reloadUntil=this.tick+weapon.reloadTicks;
  }
  broadcast(room){const message={type:'state',tick:this.tick,players:this.snapshot(room),match:this.matchSnapshot(room),arena:shiftSnapshot(room.arena,room.arenaTick)};for(const p of room.players.values())this.send(p,message);}
  step(){
    this.tick++;const actions=[];
    for(const room of this.rooms.values()){
      const entered=[...room.players.values()].filter(p=>p.entered),enoughPlayers=entered.length>=2;
      if((room.phase==='waiting'&&enoughPlayers)||(room.phase==='ended'&&enoughPlayers&&entered.every(p=>room.ready.has(p.id))))this.beginRound(room);
      if(room.phase==='countdown'&&this.tick>=room.startTick){room.phase='active';this.broadcast(room);}
      if(room.phase==='active'){
        room.arenaTick=this.tick;
        if(this.tick>=room.endTick)this.endRound(room);
        else if(stepShift(room.arena,this.tick,[...room.players.values()].filter(p=>p.entered&&p.health>0).map(p=>p.player)))this.broadcast(room);
      }
    }
    for(const peer of this.peers){
      if(performance.now()-peer.lastSeen>15000){peer.socket.terminate();continue;}
      if(!peer.room)continue;
      if(peer.room.phase==='active'&&peer.respawnAt&&this.tick>=peer.respawnAt)this.respawn(peer);
      if(peer.reloadUntil&&this.tick>=peer.reloadUntil){peer.reloadUntil=0;peer.ammo=getWeapon(peer.weaponId).magazine;}
      let input=peer.queue.shift();
      if(input){peer.ack=input.seq;if(input.life!==peer.life)input=null;}
      if(peer.health>0&&(peer.room.phase==='waiting'||peer.room.phase==='active')){
        if(input){peer.yaw=input.yaw;peer.pitch=input.pitch;peer.lastInput=input;peer.lastInputAt=performance.now();}
        const idle={yaw:peer.yaw,slide:!peer.paused&&performance.now()-(peer.lastInputAt||0)<250&&!!peer.lastInput?.slide};
        stepPlayer(peer.player,input||idle,TICK,arenaCollisionBoxes(peer.room.arena),pads);
        if(outsideArena(peer.player))this.respawn(peer);
        if(peer.room.phase==='active'&&input?.reload&&peer.ammo<getWeapon(peer.weaponId).magazine&&!peer.reloadUntil)peer.reloadUntil=this.tick+getWeapon(peer.weaponId).reloadTicks;
        if(input?.fire)actions.push([peer,input]);
      }
      peer.history.push({tick:this.tick,life:peer.life,health:peer.health,player:{...peer.player}});
      if(peer.history.length>RIFLE.maxRewindTicks+2)peer.history.shift();
    }
    // Move everyone first, then resolve hits against the same simulation tick.
    for(const [peer,input] of actions)this.fire(peer,input);
    if(this.tick%6===0)for(const room of this.rooms.values())this.broadcast(room);
  }
  remove(peer){
    this.peers.delete(peer);
    if(peer.room){const room=peer.room;
      const remaining=[...room.players.values()].filter(p=>p!==peer&&p.entered);
      if(room.phase==='active'&&peer.entered&&remaining.length<2)this.endRound(room,'forfeit',remaining[0]?.id||null);
      room.players.delete(peer.id);room.ready.delete(peer.id);peer.room=null;
      if(room.phase==='countdown'&&remaining.length<2){room.phase='waiting';room.ready.clear();room.result=null;}
      if(room.players.size)this.broadcast(room);else this.rooms.delete(room.code);
    }
  }
  close(){for(const peer of this.peers)peer.socket.terminate();this.peers.clear();this.rooms.clear();}
}
