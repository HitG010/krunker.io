import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';
const dist=resolve('dist');let count=0;
async function compress(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=resolve(directory,entry.name);if(entry.isDirectory()){await compress(path);continue;}
  if(!['.html','.js','.css','.svg','.json'].includes(extname(path)))continue;
  const content=await readFile(path);if(content.length<256)continue;
  await writeFile(path+'.gz',gzipSync(content,{level:9}));await writeFile(path+'.br',brotliCompressSync(content,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}));count++;
}}
await compress(dist);console.log(`Precompressed ${count} production assets (gzip + Brotli).`);
