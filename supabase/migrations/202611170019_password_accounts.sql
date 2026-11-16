-- Private login names are independent from room display names and profile pools.
begin;
create table public.account_logins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 login_name text not null unique check(login_name=lower(login_name) and login_name ~ '^[a-z0-9_]{3,24}$')
);
alter table public.account_logins enable row level security;
revoke all on public.account_logins from public,anon,authenticated;

create function public.my_account_login() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('login_name',(select a.login_name from public.account_logins a where a.user_id=u.id),'has_password',coalesce(length(u.encrypted_password)>0,false))
 from auth.users u where u.id=auth.uid() and public.is_registered_account()
$$;
create function public.login_name_available(proposed_name text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(lower(trim(proposed_name)) ~ '^[a-z0-9_]{3,24}$',false) and not exists(select 1 from public.account_logins where login_name=lower(trim(proposed_name)))
$$;
create function public.set_my_login_name(proposed_name text) returns void language plpgsql security definer set search_path=public as $$
declare normal text=lower(trim(proposed_name));
begin
 if not public.is_registered_account() then raise exception 'Verify your email before setting a login name';end if;
 if not public.account_login_allowed() then raise exception 'Quit your room before changing account settings';end if;
 if normal is null or normal !~ '^[a-z0-9_]{3,24}$' then raise exception 'Use 3–24 letters, numbers or underscores for your login name';end if;
 if not exists(select 1 from auth.users where id=auth.uid() and length(encrypted_password)>0) then raise exception 'Set your password before choosing your login name';end if;
 begin
  insert into public.account_logins(user_id,login_name) values(auth.uid(),normal) on conflict(user_id) do update set login_name=excluded.login_name;
 exception when unique_violation then raise exception 'This login name is already taken';end;
end $$;

-- Reserve a new account's unique name in the same transaction as Auth signup.
-- Existing email-code accounts are deliberately left untouched until their owners finish setup.
create function public.register_password_account() returns trigger language plpgsql security definer set search_path=public as $$
declare normal text=lower(trim(new.raw_user_meta_data->>'login_name'));name text=trim(new.raw_user_meta_data->>'display_name');
begin
 if coalesce(new.is_anonymous,true) or normal is null then return new;end if;
 if normal !~ '^[a-z0-9_]{3,24}$' then raise exception 'Invalid login name';end if;
 if name is null or length(name) not between 1 and 32 then raise exception 'Invalid room display name';end if;
 insert into public.account_logins(user_id,login_name) values(new.id,normal);
 insert into public.user_profiles(user_id,display_name,role_pools) values(new.id,name,'{"Top":[],"Jungle":[],"Mid":[],"ADC":[],"Support":[]}');
 return new;
end $$;
create trigger register_password_account after insert on auth.users for each row execute function public.register_password_account();

-- Login lookup is callable only by the server function; no public username-to-email mapping.
create table public.account_login_limits(bucket text primary key,started_at timestamptz not null,attempts integer not null);
alter table public.account_login_limits enable row level security;
revoke all on public.account_login_limits from public,anon,authenticated;
create function public.password_login_target(identifier text,client_fingerprint text) returns jsonb language plpgsql security definer set search_path=public as $$
declare normal text=lower(trim(identifier));attempt integer;target text;
begin
 if client_fingerprint is null or client_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid login request';end if;
 delete from public.account_login_limits where started_at<clock_timestamp()-interval '10 minutes';
 insert into public.account_login_limits as limits(bucket,started_at,attempts) values(client_fingerprint,clock_timestamp(),1)
 on conflict(bucket) do update set attempts=limits.attempts+1 returning attempts into attempt;
 if attempt>30 then return jsonb_build_object('limited',true);end if;
 if normal is null or length(normal)>320 then return jsonb_build_object('limited',false,'email',null);end if;
 if position('@' in normal)>0 then target=normal;
 else select u.email into target from public.account_logins a join auth.users u on u.id=a.user_id where a.login_name=normal;end if;
 return jsonb_build_object('limited',false,'email',target);
end $$;
revoke all on function public.my_account_login(),public.login_name_available(text),public.set_my_login_name(text),public.register_password_account(),public.password_login_target(text,text) from public,anon,authenticated;
grant execute on function public.my_account_login(),public.login_name_available(text),public.set_my_login_name(text) to authenticated;
grant execute on function public.password_login_target(text,text) to service_role;
commit;
