-- Initial champion-pool setup for new accounts; existing profiles are already configured.
begin;
alter table public.user_profiles add column onboarding_complete boolean not null default true;

create or replace function public.register_password_account() returns trigger language plpgsql security definer set search_path=public as $$
declare normal text=lower(trim(new.raw_user_meta_data->>'login_name'));name text=trim(new.raw_user_meta_data->>'display_name');
begin
 if coalesce(new.is_anonymous,true) or normal is null then return new;end if;
 if normal !~ '^[a-z0-9_]{3,24}$' then raise exception 'Invalid login name';end if;
 if name is null or length(name) not between 1 and 32 then raise exception 'Invalid room display name';end if;
 insert into public.account_logins(user_id,login_name) values(new.id,normal);
 insert into public.user_profiles(user_id,display_name,role_pools,onboarding_complete) values(new.id,name,'{"Top":[],"Jungle":[],"Mid":[],"ADC":[],"Support":[]}',false);
 return new;
end $$;

create or replace function public.save_my_profile(new_name text,new_pools jsonb,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.user_profiles;entry record;
begin
 if not public.is_registered_account() then raise exception 'Sign in with a verified email before saving a profile';end if;
 if new_name is null or length(trim(new_name)) not between 1 and 32 then raise exception 'Choose a display name between 1 and 32 characters';end if;
 if jsonb_typeof(new_pools) is distinct from 'object' or exists(select 1 from jsonb_object_keys(new_pools) key where key not in ('Top','Jungle','Mid','ADC','Support')) then raise exception 'Invalid personal role pools';end if;
 for entry in select * from jsonb_each(new_pools) loop perform public.validate_role_pool(entry.value);end loop;
 select * into p from public.user_profiles where user_id=auth.uid() for update;
 if found then
  if p.version is distinct from expected_version then raise exception 'Conflict: profile updated. Reload your profile and try again.';end if;
  update public.user_profiles set display_name=trim(new_name),role_pools=new_pools,version=version+1,updated_at=now(),onboarding_complete=true where user_id=auth.uid() returning * into p;
 else
  if expected_version is distinct from 0 then raise exception 'Conflict: profile updated. Reload your profile and try again.';end if;
  begin insert into public.user_profiles(user_id,display_name,role_pools) values(auth.uid(),trim(new_name),new_pools) returning * into p;
  exception when unique_violation then raise exception 'Conflict: profile updated. Reload your profile and try again.';end;
 end if;return to_jsonb(p);
end $$;

-- A departing owner must not leave their personal candidates in a free role.
create or replace function public.reconcile_role_pools() returns trigger language plpgsql set search_path=public as $$
declare pools jsonb;p jsonb;
begin
 perform public.validate_role_pools(new.state->'rolePools');
 pools=new.state->'rolePools';
 if tg_op='UPDATE' then
  pools=coalesce(pools,old.state->'rolePools');
  for p in select value from jsonb_array_elements(old.state->'players') loop
   if p->>'role' is not null and not exists(select 1 from jsonb_array_elements(new.state->'players') n where n->>'role'=p->>'role') then
    pools=coalesce(pools,'{}'::jsonb);pools=jsonb_set(pools,'{ally}',coalesce(pools->'ally','{}'::jsonb));
    pools=jsonb_set(pools,array['ally',p->>'role'],'[]'::jsonb);
   end if;
  end loop;
 end if;
 if pools is not null then
  for p in select value from jsonb_array_elements(new.state->'players') loop
   if p->>'role' is not null then pools=pools#-array['ally',p->>'role'];end if;
  end loop;
  new.state=jsonb_set(new.state,'{rolePools}',pools);
 end if;
 return new;
end $$;
notify pgrst,'reload schema';
commit;
