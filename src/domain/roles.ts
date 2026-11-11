import type { Role } from "./types";
// Statistical datasets use the ADC key; the interface displays Bottom.
export const roleName = (role: Role) => (role === "ADC" ? "Bottom" : role);
export const roleIcon = (role: Role) =>
  `/icons/${roleName(role).toLowerCase()}.png`;
