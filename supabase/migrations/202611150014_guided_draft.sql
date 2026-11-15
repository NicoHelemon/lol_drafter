-- Guided classic ranked/tournament draft. Statistical data is untouched.
begin;
create or replace function public.validate_draft(s jsonb) returns void language plpgsql set search_path=public as $$
declare t text;p jsonb;c text;seen text[]='{}';roles text[];seats text[]='{}';ids text[]='{}';ds jsonb;team_bans text[];
begin
 if coalesce(s->>'phase','') not in ('setup','live') or coalesce(s->>'side','') not in ('blue','red') then raise exception 'Invalid room state';end if;
 if jsonb_typeof(s->'players') is distinct from 'array' or jsonb_array_length(s->'players') not between 1 and 5 then raise exception 'Up to five players allowed';end if;
 for p in select value from jsonb_array_elements(s->'players') loop
  if coalesce(p->>'id','')='' or p->>'id'=any(ids) or coalesce(trim(p->>'name'),'')='' or length(p->>'name')>32 then raise exception 'Invalid player';end if;ids=array_append(ids,p->>'id');
  if p->>'role' is not null then
   if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(seats) then raise exception 'Role already taken or invalid';end if;seats=array_append(seats,p->>'role');
  end if;
  if jsonb_typeof(p->'pool') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p->'pool') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9]{1,5}$') or (select count(*)<>count(distinct value) from jsonb_array_elements(p->'pool')) then raise exception 'Invalid pool';end if;
 end loop;
 foreach t in array array['ally','enemy'] loop
  if jsonb_typeof(s->'picks'->t) is distinct from 'array' or jsonb_array_length(s->'picks'->t)>5 or jsonb_typeof(s->'bans'->t) is distinct from 'array' or jsonb_array_length(s->'bans'->t)<>5 then raise exception 'Up to five picks and bans per team';end if;
  roles='{}';
  for p in select value from jsonb_array_elements(s->'picks'->t) loop
   c=p->>'championId';if c is null or c!~'^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion already used or invalid';end if;seen=array_append(seen,c);
   if p->>'role' is null then raise exception 'Every pick must have a role';end if;
   if p->>'role' is not null then
    if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(roles) then raise exception 'Role occupied or invalid';end if;roles=array_append(roles,p->>'role');
   end if;
  end loop;
  team_bans='{}';
  for p in select value from jsonb_array_elements(s->'bans'->t) loop
   if p='null'::jsonb then continue;end if;c=p#>>'{}';
   if jsonb_typeof(p)<>'string' or c!~'^[0-9]{1,5}$' or c=any(team_bans) or (c=any(seen) and not(coalesce(s->>'draftMode','')='ranked' and t='enemy' and s->'bans'->'ally' ? c and not exists(select 1 from jsonb_array_elements((s->'picks'->'ally')||(s->'picks'->'enemy')) x where x->>'championId'=c))) then raise exception 'Champion already used or invalid';end if;
   seen=array_append(seen,c);team_bans=array_append(team_bans,c);
  end loop;
 end loop;
 if jsonb_typeof(s->'history') is distinct from 'array' or jsonb_array_length(s->'history')>25 then raise exception 'Invalid history';end if;
 ds=s->'dataset';
 if jsonb_typeof(ds) is distinct from 'object' or jsonb_typeof(ds->'pairs') is distinct from 'array' or jsonb_array_length(ds->'pairs')>100000 then raise exception 'Invalid dataset';end if;
 foreach t in array array['id','patch','tier','source','importedAt'] loop
  if jsonb_typeof(ds->t) is distinct from 'string' or length(ds->>t)=0 then raise exception 'Missing metadata';end if;
 end loop;
 if jsonb_typeof(ds->'fictional') is distinct from 'boolean' then raise exception 'Dataset provenance required';end if;perform (ds->>'importedAt')::timestamptz;
 for p in select value from jsonb_array_elements(ds->'pairs') loop
  if coalesce(p->>'relation','') not in ('vs','with') or coalesce(p->>'candidateRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'otherRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'candidateChampionId','')!~'^[0-9]{1,5}$' or coalesce(p->>'otherChampionId','')!~'^[0-9]{1,5}$' then raise exception 'Invalid pair';end if;
  if p->'delta2' is null or (p->'delta2'<>'null'::jsonb and (jsonb_typeof(p->'delta2')<>'number' or abs((p->>'delta2')::numeric)>100)) then raise exception 'Invalid score';end if;
  if p->>'relation'='with' and p->>'candidateRole'=p->>'otherRole' then raise exception 'Invalid same-role synergy';end if;
  if p?'games' and (jsonb_typeof(p->'games')<>'number' or (p->>'games')::numeric<0 or (p->>'games')::numeric<>trunc((p->>'games')::numeric)) then raise exception 'Invalid games count';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(ds->'pairs') x group by x->>'relation',x->>'candidateChampionId',x->>'candidateRole',x->>'otherChampionId',x->>'otherRole' having count(*)>1) then raise exception 'Duplicate pair';end if;
end $$;

create function public.draft_stages(mode text) returns jsonb language sql immutable set search_path=public as $$
 select case mode when 'ranked' then '[{"kind":"bans","count":10},{"kind":"pick","side":"blue","count":1},{"kind":"pick","side":"red","count":2},{"kind":"pick","side":"blue","count":2},{"kind":"pick","side":"red","count":2},{"kind":"pick","side":"blue","count":2},{"kind":"pick","side":"red","count":1}]'::jsonb
 else '[{"kind":"ban","side":"blue","slot":0},{"kind":"ban","side":"red","slot":0},{"kind":"ban","side":"blue","slot":1},{"kind":"ban","side":"red","slot":1},{"kind":"ban","side":"blue","slot":2},{"kind":"ban","side":"red","slot":2},{"kind":"pick","side":"blue","count":1},{"kind":"pick","side":"red","count":2},{"kind":"pick","side":"blue","count":2},{"kind":"pick","side":"red","count":1},{"kind":"ban","side":"red","slot":3},{"kind":"ban","side":"blue","slot":3},{"kind":"ban","side":"red","slot":4},{"kind":"ban","side":"blue","slot":4},{"kind":"pick","side":"red","count":1},{"kind":"pick","side":"blue","count":2},{"kind":"pick","side":"red","count":1}]'::jsonb end
$$;
create function public.draft_checkpoint(s jsonb) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('bans',s->'bans','picks',jsonb_build_object(
 'ally',(select coalesce(jsonb_agg(x->>'championId' order by x->>'championId'),'[]') from jsonb_array_elements(s->'picks'->'ally') x),
 'enemy',(select coalesce(jsonb_agg(x->>'championId' order by x->>'championId'),'[]') from jsonb_array_elements(s->'picks'->'enemy') x)))
$$;
create function public.guard_guided_draft() returns trigger language plpgsql security definer set search_path=public as $$
declare s jsonb;prev jsonb;stages jsonb;st jsonb;idx integer;oldidx integer;hist jsonb;oldhist jsonb;base jsonb;currentcp jsonb;team text;active_team text;extra integer;i integer;oldst jsonb;
begin
 s=new.state;
 if coalesce(s->>'draftMode','') not in ('ranked','tournament') then raise exception 'Choose ranked or tournament draft';end if;
 stages=public.draft_stages(s->>'draftMode');
 if s?'draftStep' and (jsonb_typeof(s->'draftStep')<>'number' or (s->>'draftStep')::numeric<>trunc((s->>'draftStep')::numeric)) then raise exception 'Invalid draft step';end if;
 idx=coalesce((s->>'draftStep')::integer,0);hist=coalesce(s->'draftHistory','[]'::jsonb);
 if jsonb_typeof(hist)<>'array' then raise exception 'Invalid draft history';end if;
 if idx<0 or idx>jsonb_array_length(stages) or jsonb_array_length(hist)<>idx then raise exception 'Invalid draft progression';end if;
 if s->>'phase'='setup' then
  if idx<>0 or hist<>'[]' or s->'picks'->'ally'<>'[]' or s->'picks'->'enemy'<>'[]' or s->'bans'<>jsonb_build_object('ally','[null,null,null,null,null]'::jsonb,'enemy','[null,null,null,null,null]'::jsonb) then raise exception 'Picks and bans start in the draft';end if;
  if s->>'draftMode'='ranked' and exists(select 1 from jsonb_each(coalesce(s->'rolePools'->'enemy','{}')) p where p.value<>'[]'::jsonb) then raise exception 'Enemy candidates are unavailable in the ranked lobby';end if;
 end if;
 if tg_op='INSERT' then
  if s->>'phase'<>'setup' then raise exception 'Create a lobby first';end if;
  return new;
 end if;
 prev=old.state;
 if s->'draftMode' is distinct from prev->'draftMode' then raise exception 'Draft mode is fixed when creating the room';end if;
 if prev->>'phase'='setup' then
  if s->>'phase'='live' and (idx<>0 or hist<>'[]' or public.draft_checkpoint(s) is distinct from public.draft_checkpoint(prev)) then raise exception 'Start at the first draft step';end if;
  return new;
 end if;
 if s->'side' is distinct from prev->'side' then raise exception 'Side is locked during the draft';end if;
 oldidx=coalesce((prev->>'draftStep')::integer,0);oldhist=coalesce(prev->'draftHistory','[]');currentcp=public.draft_checkpoint(s);
 if idx=oldidx then
  if hist is distinct from oldhist then raise exception 'Confirmed draft history is locked';end if;
 elsif idx=oldidx+1 then
  if auth.uid() is distinct from old.host_id then raise exception 'Only the host can confirm draft steps';end if;
  oldst=stages->oldidx;
  if oldst is null then raise exception 'Draft is already complete';end if;
  active_team=case when prev->>'side'=oldst->>'side' then 'ally' else 'enemy' end;
  base=coalesce(oldhist->(oldidx-1),'{"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]}}');
  if oldst->>'kind'='pick' and jsonb_array_length(prev->'picks'->active_team)<>jsonb_array_length(base->'picks'->active_team)+(oldst->>'count')::integer then raise exception 'Complete the current draft step first';end if;
  if hist is distinct from oldhist||jsonb_build_array(public.draft_checkpoint(prev)) or currentcp is distinct from public.draft_checkpoint(prev) then raise exception 'Invalid draft confirmation';end if;
 elsif idx=oldidx-1 and oldidx>0 then
  if auth.uid() is distinct from old.host_id or hist is distinct from (oldhist-(oldidx-1)) or currentcp is distinct from oldhist->(oldidx-1) then raise exception 'Invalid previous draft step';end if;
 else raise exception 'Advance one draft step at a time';end if;
 st=stages->idx;
 active_team=case when s->>'side'=st->>'side' then 'ally' else 'enemy' end;
 base=coalesce(hist->(idx-1),'{"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]}}');
 foreach team in array array['ally','enemy'] loop
  if exists(select 1 from jsonb_array_elements_text(base->'picks'->team) p where not (currentcp->'picks'->team ? p)) then raise exception 'Confirmed picks are locked';end if;
  extra=case when st->>'kind'='pick' and team=active_team then (st->>'count')::integer else 0 end;
  if jsonb_array_length(s->'picks'->team)>jsonb_array_length(base->'picks'->team)+extra then raise exception 'Follow the current pick order';end if;
  for i in 0..4 loop
   if not(coalesce(st->>'kind'='bans',false) or coalesce(st->>'kind'='ban' and team=active_team and (st->>'slot')::integer=i,false)) and s->'bans'->team->i is distinct from base->'bans'->team->i then raise exception 'Follow the current ban order';end if;
  end loop;
 end loop;
 return new;
end $$;
create trigger guard_guided_draft before insert or update of state on public.rooms for each row execute function public.guard_guided_draft();
revoke all on function public.draft_stages(text),public.draft_checkpoint(jsonb),public.guard_guided_draft() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
