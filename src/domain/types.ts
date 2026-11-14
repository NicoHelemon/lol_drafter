export const ROLES = ['Top','Jungle','Mid','ADC','Support'] as const;
export type Role = typeof ROLES[number];
export type Team = 'ally'|'enemy';
export interface Champion {id:string; name:string; portrait:string}
export interface Pair {relation:'vs'|'with'; candidateChampionId:string; candidateRole:Role; otherChampionId:string; otherRole:Role; delta2:number|null; games?:number}
export interface ShrinkageModel {
 method:'normal-normal-v1'; k:number|null; priorVariance:number; noiseVariance:2500;
 fittedAt:string; reviewAfter:string; trainingSnapshotId:string; contextKey:string;
 observations:number; relationCounts:{vs:number;with:number};
}
export interface Dataset {id:string; patch:string; tier:string; source:string; importedAt:string; fictional:boolean; pairs:Pair[]; snapshotId?:string; context?:Record<string,string|number>}
export interface RolePopularity {championId:string;role:Role;lanePercent:number;pickPercent:number;games:number}
export interface RoleCatalogue {schemaVersion:1;capturedAt:string;source:string;context:Record<string,string|number>;entries:RolePopularity[];fictional?:boolean}
export interface Player {id:string; name:string; role:Role|null; pool:string[]}
export interface Pick {championId:string; role:Role}
export interface State {phase:'setup'|'live'; side:'blue'|'red'; dataset:Dataset; players:Player[]; picks:Record<Team,Pick[]>; bans:Record<Team,(string|null)[]>; history:string[]; shrinkage?:ShrinkageModel;roleCatalogue?:RoleCatalogue}
export interface Room {id:string;slug:string;name:string; host_id:string; version:number; state:State}

export interface RoleSwapRequest {id:string;room_id:string;requester_id:string;target_id:string;from_role:Role;to_role:Role;created_at:string;expires_at:string;phase?:'setup'|'live';from_champion_id?:string|null;to_champion_id?:string|null}

export interface PickSwapRequest {
 id:string; room_id:string; requester_id:string;
 from_role:Role; to_role:Role; from_player_id:string; to_player_id:string;
 from_champion_id:string; to_champion_id:string|null;
 from_accepted:boolean; to_accepted:boolean; created_at:string; expires_at:string;
}
