import { useState } from "react";
import type { Role } from "../domain/types";
import { roleIcon } from "../domain/roles";
export function RoleIcon({ role }: { role: Role }) {
  return <img className="role-image" src={roleIcon(role)} alt="" />;
}
export function SwapIcon() {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span aria-hidden="true">⇅</span>
  ) : (
    <img
      className="swap-image"
      alt=""
      src="https://raw.communitydragon.org/16.1/plugins/rcp-fe-lol-champ-select/global/default/images/summoner/button-swap.png"
      onError={() => setFailed(true)}
    />
  );
}
