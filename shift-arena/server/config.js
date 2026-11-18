export function normalizePublicOrigin(value){
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw Error('PUBLIC_ORIGIN must be an http(s) origin');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('PUBLIC_ORIGIN must be an http(s) origin without a path, query or credentials');
  return url.origin;
}
export function runtimeConfig(env=process.env,args=process.argv.slice(2)){
  const dev=args.includes('--dev'),raw=env.PORT??'5173';
  if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>65535)throw Error('PORT must be an integer from 1 to 65535');
  return {port:Number(raw),host:env.HOST||(dev&&!args.includes('--lan')?'127.0.0.1':'0.0.0.0'),dev,requireBuild:!dev,publicOrigin:normalizePublicOrigin(env.PUBLIC_ORIGIN)};
}
export function allowedOrigin(origin,host,publicOrigin=null){
  if(origin===undefined)return true; // Browser requests carry Origin; native clients may omit it.
  try{const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)return false;return publicOrigin?parsed.origin===publicOrigin:parsed.host===host;}catch{return false;}
}
