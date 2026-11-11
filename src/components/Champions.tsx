import { useState } from "react";
import { champions, byId } from "../data/provider";
export const names = Object.fromEntries(champions.map((c) => [c.id, c.name]));
export function Portrait({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span aria-hidden="true" className="portrait fallback">
      {(names[id] ?? "?").slice(0, 2)}
    </span>
  ) : (
    <img
      className="portrait"
      alt=""
      src={byId[id]?.portrait}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
export function Search({
  selected = [],
  blocked = new Set(),
  onChoose,
}: {
  selected?: string[];
  blocked?: Set<string>;
  onChoose: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  return (
    <>
      <input
        autoFocus
        aria-label="Search champions"
        placeholder="Search champions…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="champion-grid">
        {champions
          .filter((c) =>
            c.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
          )
          .map((c) => (
            <button
              key={c.id}
              disabled={blocked.has(c.id)}
              className={
                selected.includes(c.id) ? "champion selected" : "champion"
              }
              onClick={() => onChoose(c.id)}
            >
              <Portrait id={c.id} />
              <span>{c.name}</span>
              {selected.includes(c.id) && <b>✓</b>}
            </button>
          ))}
      </div>
    </>
  );
}
