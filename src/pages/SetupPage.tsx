import { ROLES, type State, type RoleSwapRequest, type Team, type Role } from "../domain/types";
import { roleName } from "../domain/roles";
import { Portrait, names } from "../components/Champions";
import {rolePool} from "../domain/rolePools";
import SideSelector from "../components/SideSelector";
import { RoleIcon, SwapIcon } from "../components/RoleIcon";
interface Props {
  state: State;
  uid: string;
  host: boolean;
  hostId: string;
  busy: boolean;readOnly?:boolean;
  online: string[];
  swaps: RoleSwapRequest[];
  change: (fn: (s: State) => State) => Promise<void>;
  editPool: (team:Team,role:Role) => void;
  updatePool:(team:Team,role:Role,pool:string[])=>void;
  requestSwap: (target: string) => void;claimRole:(role:Role)=>void;onSavePool?:(role:Role)=>void;
}
export default function SetupPage({
  state,
  uid,
  host,
  hostId,
  busy,readOnly=false,
  online,
  swaps,change,
  editPool,updatePool,
  requestSwap,claimRole,onSavePool,
}: Props) {
  const me = state.players.find((p) => p.id === uid);
  return (
    <section aria-label="Room preparation" className="setup-page">
      {state.draftMode&&<p className="eyebrow">{state.draftMode==='ranked'?'Ranked draft':'Tournament draft'}</p>}
      {((state.draftMode==='ranked'?['ally']:['ally','enemy']) as Team[]).map(team=><section className={`setup-team ${team}`} key={team}>
      <h2>{team==='ally'?'Ally team':'Enemy team'}</h2>
      <div className="side-roster-row">
      <SideSelector label={team==='ally'?'Ally team side':'Enemy team side'} side={team==='ally'?state.side:state.side==='blue'?'red':'blue'} disabled={busy||!host||readOnly} onChange={side=>void change(s=>({...s,side:team==='ally'?side:side==='blue'?'red':'blue'}))}/>
      <section className="roster">
        {ROLES.map((role) => {
          const p = team==='ally'?state.players.find((p) => p.role === role):undefined,
            pool=rolePool(state,team,role),editable = !readOnly&&(!p || p.id === uid || host),
            canSwap = !readOnly&&!!me?.role && !!p && p.id !== uid;
          return (
            <div
              role="group"
              aria-label={`${roleName(role)}${team==='enemy'?' enemy':''} role`}
              className={"seat " + (p?.id === uid ? "mine" : "")}
              key={role}
            >
              <div className="seat-top">
                <RoleIcon role={role} />
                <b>{roleName(role)}</b>
              </div>
              {p && (
                <div className="seat-name">
                  <i className={online.includes(p.id) ? "dot" : "dot off"} />
                  {p.name}
                  {p.id === hostId && <b className="host-badge">HOST</b>}
                  {p.id === uid && <small>you</small>}
                </div>
              )}
                  <div className="pool-tiles">
                    {pool.map((id) => (
                      <div className="pool-tile" key={id} title={names[id]}>
                        <Portrait id={id} />
                        {editable && (
                          <button
                            className="remove-champion"
                            aria-label={`Remove ${names[id]} from ${roleName(role)}${team==='enemy'?' enemy':''} pool`}
                            disabled={busy}
                            onClick={() => updatePool(team,role,pool.filter(c=>c!==id))}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {editable && (
                      <button
                        className="add-champion"
                        aria-label={`Add champion to ${roleName(role)}${team==='enemy'?' enemy':''} pool`}
                        disabled={busy}
                        onClick={() => editPool(team,role)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {p?.id===uid&&onSavePool&&<button disabled={busy} title={`Save these candidates to your personal ${roleName(role)} pool`} onClick={()=>onSavePool(role)}>Save my {roleName(role)} pool</button>}
                  {canSwap && p && (
                    <button
                      className="swap-overlay"
                      aria-label={`Swap role with ${p.name}`}
                      disabled={
                        busy ||
                        swaps.some(
                          (r) =>
                            [r.requester_id, r.target_id].includes(uid) ||
                            [r.requester_id, r.target_id].includes(p.id),
                        )
                      }
                      onClick={() => requestSwap(p.id)}
                    >
                      <RoleIcon role={role} />
                      <SwapIcon />
                      <span>Swap role</span>
                    </button>
                  )}
              {team==='ally'&&!p&&(
                <button
                  disabled={busy}
                  onClick={()=>claimRole(role)}
                >
                  Join
                </button>
              )}
            </div>
          );
        })}
      </section></div></section>)}

    </section>
  );
}
