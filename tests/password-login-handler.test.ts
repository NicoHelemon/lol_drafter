import {it,expect,vi} from 'vitest';
import {passwordLoginHandler} from '../supabase/functions/account-password-login/handler';
const config={url:'https://example.supabase.co',publicKey:'test-public-key',serviceKey:'test-server-secret'};
const request=(body:unknown={identifier:'My_Login',password:'test-password-only'},method='POST',origin='https://draftroom-lol.netlify.app')=>new Request('https://example.supabase.co/functions/v1/account-password-login',{method,headers:{origin,'content-type':'application/json','x-forwarded-for':'192.0.2.1'},body:method==='POST'?JSON.stringify(body):undefined});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
it('resolves privately then returns session tokens without exposing server credentials or directory data',async()=>{
 const call=vi.fn().mockResolvedValueOnce(json({limited:false,email:'private@example.test'})).mockResolvedValueOnce(json({access_token:'test-access',refresh_token:'test-refresh',user:{email:'private@example.test'}}));
 const result=await passwordLoginHandler(config,call)(request());expect(result.status).toBe(200);expect(await result.json()).toEqual({access_token:'test-access',refresh_token:'test-refresh'});
 const lookup=call.mock.calls[0][1];expect(JSON.parse(lookup.body)).toEqual({identifier:'My_Login',client_fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(lookup.headers.Authorization).toBe('Bearer test-server-secret');
 const auth=call.mock.calls[1][1];expect(auth.headers.apikey).toBe('test-public-key');expect(JSON.parse(auth.body)).toEqual({email:'private@example.test',password:'test-password-only'});expect(result.headers.get('Cache-Control')).toBe('no-store');
});
it('returns the same generic message for unknown names and incorrect passwords',async()=>{
 const responses=[];
 for(const email of [null,'private@example.test']){const call=vi.fn().mockResolvedValueOnce(json({limited:false,email})).mockResolvedValueOnce(json({msg:'Detailed internal Auth error'},400));const result=await passwordLoginHandler(config,call)(request());expect(result.status).toBe(401);responses.push(await result.text());}
 expect(responses[0]).toBe(responses[1]);expect(responses[0]).not.toContain('private@example.test');expect(responses[0]).not.toContain('Detailed internal');
});
it('stops a rate-limited request before checking its password',async()=>{
 const call=vi.fn().mockResolvedValue(json({limited:true}));const result=await passwordLoginHandler(config,call)(request());expect(result.status).toBe(429);expect(call).toHaveBeenCalledOnce();
});
it('sanitizes upstream and transport failures',async()=>{
 for(const call of [vi.fn().mockResolvedValue(json({error:'test-server-secret'},500)),vi.fn().mockRejectedValue(Error('test-server-secret'))]){const result=await passwordLoginHandler(config,call)(request());expect(result.status).toBe(503);expect(await result.text()).not.toContain('test-server-secret');}
});
it('validates request size, methods, fields and origins before making any server call',async()=>{
 const call=vi.fn();const handler=passwordLoginHandler(config,call);
 expect((await handler(request({},'GET'))).status).toBe(405);expect((await handler(request({},'POST','https://untrusted.example'))).status).toBe(403);expect((await handler(request({identifier:'name',password:'x'.repeat(4100)}))).status).toBe(413);
 for(const body of [null,{}, {identifier:'',password:'pass'},{identifier:'name',password:42}])expect((await handler(request(body))).status).toBe(400);
 expect(call).not.toHaveBeenCalled();const cors=await handler(request({},'OPTIONS'));expect(cors.status).toBe(204);expect(cors.headers.get('Access-Control-Allow-Origin')).toBe('https://draftroom-lol.netlify.app');
});
