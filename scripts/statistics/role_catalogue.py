"""Small role/popularity metadata; never filters the pairwise corpus."""
from datetime import datetime,timezone
import json
import math
from pathlib import Path
from inspect_lolalytics import QwikHTML,References,ROLES
from pipeline import CONTEXT,ROOT


def entry(champion,role,lane_percent,pick_percent,games):
    if (type(games) is not int or games<0 or any(type(n) not in (int,float)
            or not math.isfinite(n) or not 0<=n<=100 for n in (lane_percent,pick_percent))):
        raise ValueError('Invalid role popularity statistics')
    return dict(championId=str(champion),role=role,lanePercent=lane_percent,pickPercent=pick_percent,games=games)


def validate(catalogue):
    if catalogue.get('schemaVersion')!=1 or catalogue.get('context')!=CONTEXT:
        raise ValueError('Invalid role catalogue context/schema')
    if datetime.fromisoformat(catalogue['capturedAt'].replace('Z','+00:00')).tzinfo is None:
        raise ValueError('Role catalogue timestamp needs a timezone')
    ids={c['id'] for c in json.loads((ROOT/'src/data/champions.json').read_text())}
    if not isinstance(catalogue.get('source'),str) or not catalogue['source'] or not 1<=len(catalogue.get('entries',[]))<=len(ids)*5:
        raise ValueError('Invalid role catalogue size/source')
    seen=set()
    for p in catalogue['entries']:
        key=(p['championId'],p['role'])
        if p['championId'] not in ids or p['role'] not in ROLES.values() or key in seen:
            raise ValueError('Invalid or duplicate role catalogue entry')
        seen.add(key);entry(p['championId'],p['role'],p['lanePercent'],p['pickPercent'],p['games'])
    return catalogue


def document(entries,captured_at=None):
    return validate(dict(schemaVersion=1,context=CONTEXT,
        capturedAt=captured_at or datetime.now(timezone.utc).isoformat(),
        source='Lolalytics public role statistics',entries=sorted(entries,key=lambda p:(p['championId'],p['role']))))


def inspect_tierlist(raw,lane):
    """Decode the public role page's rendered row props, not a guessed endpoint."""
    parser=QwikHTML();parser.feed(raw.decode());objects=json.loads(parser.blocks[0])['objs'];refs=References(objects)
    filters=[o for o in objects if isinstance(o,dict) and set(o)=={'minLane','minGames','minPick'}]
    if len(filters)!=1 or {k:refs.read(v) for k,v in filters[0].items()}!={'minLane':2,'minGames':100,'minPick':0}:
        raise ValueError('Unexpected public tierlist listing filters')
    routes=[o for o in objects if isinstance(o,dict) and {'patch','tier','region','lane','mode'}<=o.keys()]
    if not any(all(refs.read(o[k])==v for k,v in dict(patch='14',tier='emerald_plus',region='all',lane=lane,mode='ranked').items()) for o in routes):
        raise ValueError('Tierlist filters do not match the role catalogue')
    rows=[]
    for o in objects:
        if not isinstance(o,dict) or not {'cid','row','placeholder'}<=o.keys():continue
        champion=refs.read(o['cid']);row=refs.read(o['row'])
        if row['lane']!=lane:raise ValueError('Tierlist role mismatch')
        rows.append(entry(champion,ROLES[lane],row['pctLane'],row['pr'],row['games']))
    if not rows:raise ValueError('No role rows in public tierlist')
    return rows


def bootstrap(directory):
    from collect_lolalytics import Fetcher
    fetcher=Fetcher(Path(directory)/'responses');rows=[];sources=[]
    for lane in ROLES:
        url=f'https://lolalytics.com/lol/tierlist/?lane={lane}&patch=14'
        raw,record=fetcher.get(url);rows.extend(inspect_tierlist(raw,lane));sources.append(record)
    result=document(rows,max(s['fetchedAt'] for s in sources))
    # Public tier pages list roles at >=2% and >=100 games. This is enough for
    # our 5% picker filter only when each champion has at least 2,000 observed
    # games; otherwise fail rather than hide a legitimate rare role silently.
    from collections import Counter
    totals=Counter()
    for row in rows:totals[row['championId']]+=row['games']
    ids={c['id'] for c in json.loads((ROOT/'src/data/champions.json').read_text())}
    if set(totals)!=ids or min(totals.values())<2000:
        raise ValueError('Tierlist coverage cannot safely support a five-percent role filter')
    result['listingFilters']={'minLanePercent':2,'minGames':100,'minPickPercent':0}
    return result,sources


if __name__=='__main__':
    import argparse
    from publish import query,literal
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    catalogue,sources=bootstrap(args.output)
    (args.output/'role-catalogue.json').write_text(json.dumps(catalogue,indent=2)+'\n')
    (args.output/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
    if args.apply:
        row=query('select s.id,s.metadata from public.statistics_current c join public.statistics_snapshots s on s.id=c.snapshot_id')[0]
        if row['metadata'].get('context')!=CONTEXT:raise ValueError('Current snapshot context mismatch')
        sid=literal(row['id']);value=literal(json.dumps(catalogue,separators=(',',':')))
        query(f"""begin;select pg_advisory_xact_lock(765432100);
          do $guard$ begin if not exists(select 1 from public.statistics_current where snapshot_id={sid}) then raise exception 'Current snapshot changed';end if;end $guard$;
          insert into public.statistics_role_catalogues(snapshot_id,catalogue) values({sid},{value}::jsonb);commit;""")
    print(json.dumps(dict(entries=len(catalogue['entries']),capturedAt=catalogue['capturedAt'],applied=args.apply)))
