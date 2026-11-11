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
        {players.length}
        <span>/5</span>
      </span>
      <div className="participant-list">
        {players.map((p) => (
          <span className="participant-chip" key={p.id}>
            <i className={online.includes(p.id) ? "dot" : "dot off"} />
            <span>{p.name}</span>
            {p.id === hostId && <b className="host-badge">HOST</b>}
          </span>
        ))}
      </div>
    </section>
  );
}
