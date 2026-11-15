import type { Player } from "../domain/types";
export default function Participants({
  players,
  hostId,
  online,
}: {
  players: Player[];
  hostId: string;
  online: string[];
}) {
  return (
    <section className="participants" aria-label="Room participants">
      <span className="participant-count">
        {players.filter(p=>!p.observer).length}<span>/5 players</span>
        <small>{players.filter(p=>p.observer).length}/3 observers</small>
      </span>
      <div className="participant-list">
        {players.map((p) => (
          <span className="participant-chip" key={p.id}>
            <i className={online.includes(p.id) ? "dot" : "dot off"} />
            <span>{p.name}</span>
            {p.observer&&<small className="observer-badge">OBSERVER</small>}
            {p.id === hostId && <b className="host-badge">HOST</b>}
          </span>
        ))}
      </div>
    </section>
  );
}
