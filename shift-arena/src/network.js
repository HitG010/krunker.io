import {stepPlayer} from './physics.js';
import {collisionBoxes,pads} from './arena.js';
export function reconcile(authoritative,pending,ack,boxes=collisionBoxes){
  const remaining=pending.filter(f=>f.seq>ack);
  const player={...authoritative};
  for(const input of remaining)stepPlayer(player,input,1/120,boxes,pads);
  return {player,pending:remaining};
}
export function interpolate(a,b,t){
  t=Math.max(0,Math.min(1,t));
  const angle=a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*t;
  return {...b,yaw:angle,pitch:a.pitch+(b.pitch-a.pitch)*t,player:{...b.player,x:a.player.x+(b.player.x-a.player.x)*t,y:a.player.y+(b.player.y-a.player.y)*t,z:a.player.z+(b.player.z-a.player.z)*t,height:a.player.height+(b.player.height-a.player.height)*t}};
}
export class RoomClient {
  constructor({onState,onClose,onEvent=()=>{}}){this.onEvent=onEvent;this.onState=onState;this.onClose=onClose;this.socket=null;this.id=null;this.code=null;this.pending=[];this.batch=[];this.seq=0;this.rtt=0;this.history=[];this.players=[];}
  connect(action,name,code,weaponId='rifle'){
    return new Promise((resolve,reject)=>{
      const socket=this.socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/room`);
      let joined=false;const timeout=setTimeout(()=>{reject(new Error('Connection timed out. Try again.'));socket.close();},8000);
      socket.onopen=()=>socket.send(JSON.stringify({type:action,name,code,weaponId}));
      socket.onmessage=event=>{
        const m=JSON.parse(event.data);
        if(m.type==='error'){clearTimeout(timeout);reject(new Error(m.message));socket.close();return;}
        if(m.type==='joined'){clearTimeout(timeout);joined=true;this.id=m.id;this.code=m.code;this.players=m.players;this.timer=setInterval(()=>{this.flush();if(Date.now()-(this.lastPing||0)>1000){this.lastPing=Date.now();this.send({type:'ping',at:this.lastPing});}if(Date.now()-(this.lastState||Date.now())>6000)socket.close();},33);this.lastState=Date.now();resolve(m);}
        if(m.type==='event')this.onEvent(m);
        if(m.type==='state'){this.serverTick=m.tick;this.tickAt=performance.now();this.lastState=Date.now();this.players=m.players;this.history.push({at:performance.now(),players:m.players});if(this.history.length>30)this.history.shift();this.onState(m);}
        if(m.type==='pong'&&Number.isFinite(m.at))this.rtt=Math.max(0,Date.now()-m.at);
      };
      socket.onerror=()=>{clearTimeout(timeout);if(!joined)reject(new Error('Could not connect to the room server.'));};
      socket.onclose=()=>{clearTimeout(timeout);clearInterval(this.timer);this.id=null;if(!joined)reject(new Error('Connection closed. Try again.'));else this.onClose();};
    });
  }
  send(m){if(this.socket?.readyState===1)this.socket.send(JSON.stringify(m));}
  viewTick(){return Math.max(0,Math.floor((this.serverTick||0)+(performance.now()-(this.tickAt||performance.now()))*.12-12));}
  input(input){if(!this.id)return;const frame={...input,seq:++this.seq};this.pending.push(frame);this.batch.push(frame);if(this.batch.length>=4)this.flush();if(this.pending.length>480)this.socket.close();}
  flush(){if(this.batch.length){this.send({type:'input',frames:this.batch});this.batch=[];}}
  pause(){this.flush();this.send({type:'pause'});}
  remotes(now=performance.now()){
    const target=now-100,h=this.history;if(!h.length)return [];
    let a=h[0],b=h[h.length-1];
    for(let i=1;i<h.length;i++)if(h[i].at>=target){a=h[i-1];b=h[i];break;}
    return this.players.filter(p=>p.id!==this.id).map(latest=>{
      const second=b.players.find(p=>p.id===latest.id)||latest;
      if(latest.life!==second.life||latest.health===0)return latest;
      const first=a.players.find(p=>p.id===second.id)||second;
      if(first.life!==second.life||second.health===0)return second;
      return interpolate(first,second,b.at===a.at?1:(target-a.at)/(b.at-a.at));
    });
  }
  remote(now=performance.now()){return this.remotes(now)[0]||null;}
  close(){clearInterval(this.timer);if(this.socket){this.socket.onclose=null;this.socket.close();}this.id=null;}
}
