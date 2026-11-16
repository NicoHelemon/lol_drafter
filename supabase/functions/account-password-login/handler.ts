interface Config {url:string;publicKey:string;serviceKey:string}
const allowedOrigins=new Set(['https://draftroom-lol.netlify.app','http://localhost:5173','http://localhost:5174','http://127.0.0.1:5173','http://127.0.0.1:5174']);
const invalid='Invalid login name, email or password. Confirm your email before signing in.';
export function passwordLoginHandler(config:Config,requestFetch:typeof fetch=fetch){
 return async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(origin&&allowedOrigins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  const reply=(status:number,message:unknown)=>new Response(JSON.stringify(message),{status,headers});
  if(origin&&!allowedOrigins.has(origin))return reply(403,{message:'Origin not allowed'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{message:'Use POST'});
  try{
   const text=await request.text();if(text.length>4096)return reply(413,{message:'Login request too large'});
   let body;try{body=JSON.parse(text);}catch{return reply(400,{message:'Invalid login request'});}
   if(!body||typeof body.identifier!=='string'||!body.identifier.trim()||body.identifier.length>320||typeof body.password!=='string'||!body.password||body.password.length>128)return reply(400,{message:'Enter your login name or email and password'});
   // The platform's forwarded client address is hashed with a server-only key.
   // Passwords, identifiers, addresses and Auth tokens are never logged or stored here.
   const address=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.serviceKey+':'+address));
   const fingerprint=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
   const lookup=await requestFetch(config.url+'/rest/v1/rpc/password_login_target',{method:'POST',headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,'Content-Type':'application/json'},body:JSON.stringify({identifier:body.identifier,client_fingerprint:fingerprint})});
   if(!lookup.ok)return reply(503,{message:'Sign-in is temporarily unavailable. Try again shortly.'});
   const target=await lookup.json();if(target.limited)return reply(429,{message:'Too many attempts. Try again in 10 minutes.'});
   // Unknown names follow the same Auth request and error as an incorrect password.
   const login=await requestFetch(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publicKey,'Content-Type':'application/json'},body:JSON.stringify({email:target.email||'invalid-login@invalid.invalid',password:body.password})});
   if(login.status===429)return reply(429,{message:'Too many attempts. Try again later.'});
   if(!login.ok)return reply(login.status>=500?503:401,{message:login.status>=500?'Sign-in is temporarily unavailable. Try again shortly.':invalid});
   const session=await login.json();if(!session.access_token||!session.refresh_token)return reply(503,{message:'Sign-in is temporarily unavailable. Try again shortly.'});
   return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return reply(503,{message:'Sign-in is temporarily unavailable. Try again shortly.'});}
 };
}
