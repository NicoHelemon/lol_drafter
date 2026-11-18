-- Keep prior links valid when a member needs a new invitation after losing the URL fragment.
begin;
alter table public.room_invites drop constraint room_invites_pkey;
alter table public.room_invites add primary key(room_id,token_hash);
create function public.issue_room_invitation(room_id uuid) returns text
language plpgsql security definer set search_path=public as $$
declare r public.rooms;token text;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if (select count(*) from public.room_invites i where i.room_id=r.id)>=100 then raise exception 'Invitation limit reached for this room';end if;
 token=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into public.room_invites(room_id,token_hash) values(r.id,encode(sha256(convert_to(token,'UTF8')),'hex'));
 return token;
end $$;
revoke all on function public.issue_room_invitation(uuid) from public,anon;
grant execute on function public.issue_room_invitation(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
