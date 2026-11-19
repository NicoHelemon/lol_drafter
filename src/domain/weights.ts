import { ROLES, type Role } from './types';
// Every consolidated interaction contributes equally, on fixed draft denominators.
export const WEIGHTS = Object.fromEntries(ROLES.map(role => [role, {
  vs: Object.fromEntries(ROLES.map(other => [other, 1])),
  with: Object.fromEntries(ROLES.filter(other => other !== role).map(other => [other, 1])),
}])) as Record<Role, Record<'vs' | 'with', Partial<Record<Role, number>>>>;
