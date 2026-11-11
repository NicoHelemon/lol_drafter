import type { Role } from "./types";
// Keep the persisted ADC key compatible with existing rooms, imports and coefficients.
export const roleName = (role: Role) => (role === "ADC" ? "Bottom" : role);
export const roleIcon = (role: Role) =>
  `/icons/${roleName(role).toLowerCase()}.png`;
