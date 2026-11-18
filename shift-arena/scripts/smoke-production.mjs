import {startServer} from '../server/index.js';
import {smokeOnline} from './smoke-online.mjs';
const app=await startServer({port:0,requireBuild:true});
try{console.log(await smokeOnline(`http://127.0.0.1:${app.port}`));}finally{await app.close();}
