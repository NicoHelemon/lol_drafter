import { useEffect, useState } from "react";
import type { RoleSwapRequest } from "../domain/types";
import { roleName } from "../domain/roles";
import { SwapIcon } from "./RoleIcon";
export default function SwapPrompt({
  request,
  name,
  busy,
  outgoing = false,
  onRespond,
}: {
  request: RoleSwapRequest;
  name: string;
  busy: boolean;
  outgoing?: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [request.id]);
  const remaining = Math.max(0, Date.parse(request.expires_at) - now),
    duration = Math.max(
      1,
      Date.parse(request.expires_at) - Date.parse(request.created_at),
    ),
    percent = Math.min(100, (remaining / duration) * 100);
  if (!remaining) return null;
  return (
    <div className="modal-backdrop swap-prompt">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={outgoing ? "Role swap pending" : "Role swap request"}
      >
        <div className="section-heading">
          <h2>{outgoing ? "Waiting for role swap" : "Role swap request"}</h2>
          <span className="muted" aria-label="Time remaining">
            {Math.ceil(remaining / 1000)}s
          </span>
        </div>
        <p>
          {outgoing ? (
            <>
              Waiting for <strong>{name}</strong> to accept the{" "}
              {roleName(request.from_role)} / {roleName(request.to_role)} swap.
            </>
          ) : (
            <>
              <strong>{name}</strong> wants to swap{" "}
              {roleName(request.from_role)} for your {roleName(request.to_role)}{" "}
              role.
            </>
          )}
        </p>
        <div className="swap-prompt-symbol">
          <SwapIcon />
        </div>
        <div
          className="swap-timer"
          role="progressbar"
          aria-label="Role swap time remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="modal-actions">
          {outgoing ? (
            <button disabled={busy} onClick={() => onRespond(false)}>
              Cancel
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
