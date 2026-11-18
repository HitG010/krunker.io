import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {WebSocket} from 'ws';

export async function smokeOnline(address){
  const url=new URL(address);assert.ok(['http:','https:'].includes(url.protocol),'Use an HTTP(S) game URL');
  assert.ok(!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'Use the game origin without credentials or a path');
  const health=await fetch(new URL('/api/health',url),{signal:AbortSignal.timeout(8000)});assert.equal(health.status,200,'Health endpoint must return 200');
  assert.equal((await health.json()).capacity,4,'Server must support four players');
  const page=await fetch(url,{signal:AbortSignal.timeout(8000)});assert.equal(page.status,200);assert.match(await page.text(),/id="game"/);
  const peers=[];
  async function connect(){
    const target=new URL('/room',url);target.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(target,{origin:url.origin,handshakeTimeout:8000}),messages=[];
    const peer={socket,messages,send:m=>socket.send(JSON.stringify(m)),async wait(predicate){const until=Date.now()+10000;while(Date.now()<until){const message=messages.find(predicate);if(message)return message;if(socket.readyState===WebSocket.CLOSED)throw Error('Socket closed before expected state');await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for multiplayer state');}};
    peers.push(peer);socket.on('message',raw=>{messages.push(JSON.parse(raw));if(messages.length>300)messages.shift();});
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});return peer;
  }
  try{
    const first=await connect();first.send({type:'create',name:'Smoke 1'});const joined=await first.wait(m=>m.type==='joined');
    for(let i=1;i<4;i++){const p=await connect();p.send({type:'join',name:'Smoke '+(i+1),code:joined.code});const m=await p.wait(m=>m.type==='joined');assert.equal(m.players.length,i+1);}
    const frame={seq:1,forward:0,right:0,yaw:0,pitch:0,jump:false,dash:false,slide:false};
    for(const p of peers)p.send({type:'input',frames:[frame]});
    for(const p of peers){const m=await p.wait(m=>m.type==='state'&&m.match.phase==='active'&&m.players.length===4&&m.players.every(player=>player.entered));assert.equal(new Set(m.players.map(player=>player.slot)).size,4);assert.ok(m.arena);}
    const fifth=await connect();fifth.send({type:'join',name:'Smoke 5',code:joined.code});assert.match((await fifth.wait(m=>m.type==='error')).message,/four players/);
    return {origin:url.origin,players:4,transport:url.protocol==='https:'?'wss':'ws',passed:true};
  }finally{
    await Promise.all(peers.map(p=>new Promise(resolve=>{if(p.socket.readyState===WebSocket.CLOSED)return resolve();const timer=setTimeout(()=>{p.socket.terminate();resolve();},1000);p.socket.once('close',()=>{clearTimeout(timer);resolve();});p.socket.close();})));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{if(!process.argv[2])throw Error('Usage: npm run smoke:online -- https://your-game-host');console.log(await smokeOnline(process.argv[2]));}catch(error){console.error('Online smoke check failed:',error.message);process.exitCode=1;}
}
