import { useEffect, useState } from "react";
import type { RoleSwapRequest } from "../domain/types";
import { roleName } from "../domain/roles";
import { SwapIcon } from "./RoleIcon";
export default function SwapPrompt({
  request,
  name,
  busy,
  onRespond,
}: {
  request: RoleSwapRequest;
  name: string;
  busy: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [request.id]);
  const remaining = Math.max(0, Date.parse(request.expires_at) - now);
  if (!remaining) return null;
  return (
    <div className="modal-backdrop swap-prompt">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Role swap request"
      >
        <div className="section-heading">
          <h2>Role swap request</h2>
          <span className="muted" aria-label="Time remaining">
            {Math.ceil(remaining / 1000)}s
          </span>
        </div>
        <p>
          <strong>{name}</strong> wants to swap {roleName(request.from_role)}{" "}
          for your {roleName(request.to_role)} role.
        </p>
        <div className="swap-prompt-symbol">
          <SwapIcon />
        </div>
        <div className="modal-actions">
          <button disabled={busy} onClick={() => onRespond(false)}>
            Decline
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onRespond(true)}
          >
            Accept
          </button>
        </div>
      </section>
    </div>
  );
}
