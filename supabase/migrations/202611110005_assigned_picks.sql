-- Every entered pick is immediately assigned to a role. No room data is deleted.
begin;
create or replace function public.validate_draft(s jsonb) returns void language plpgsql set search_path=public as $$
declare t text;p jsonb;c text;seen text[]='{}';roles text[];seats text[]='{}';ids text[]='{}';ds jsonb;
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
  for p in select value from jsonb_array_elements(s->'bans'->t) loop
   if p='null'::jsonb then continue;end if;c=p#>>'{}';if jsonb_typeof(p)<>'string' or c!~'^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion already used or invalid';end if;seen=array_append(seen,c);
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

commit;
