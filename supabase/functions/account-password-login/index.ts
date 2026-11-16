import {passwordLoginHandler} from './handler.ts';
Deno.serve(passwordLoginHandler({url:Deno.env.get('SUPABASE_URL')!,publicKey:Deno.env.get('SUPABASE_ANON_KEY')!,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}));
