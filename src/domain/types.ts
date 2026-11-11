export const ROLES = ['Top','Jungle','Mid','ADC','Support'] as const;
export type Role = typeof ROLES[number];
export type Team = 'ally'|'enemy';
export interface Champion {id:string; name:string; portrait:string}
export interface Pair {relation:'vs'|'with'; candidateChampionId:string; candidateRole:Role; otherChampionId:string; otherRole:Role; delta2:number|null; games?:number}
export interface Dataset {id:string; patch:string; tier:string; source:string; importedAt:string; fictional:boolean; pairs:Pair[]}
export interface Player {id:string; name:string; role:Role|null; pool:string[]; ready:boolean}
export interface Pick {championId:string; role:Role|null}
export interface State {phase:'setup'|'live'|'finished'; side:'blue'|'red'; dataset:Dataset; players:Player[]; picks:Record<Team,Pick[]>; bans:Record<Team,(string|null)[]>; history:string[]}
export interface Room {id:string; host_id:string; version:number; state:State}
