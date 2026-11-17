import {initialState} from '../../src/data/provider';
import type {Pair,State} from '../../src/domain/types';

export const popularMids=['103','157','238','517','84'];
export const topFits=['112','3','517'];
export function fitState():State {
 const s=initialState('p','Player','ranked');s.phase='live';s.openDraft=true;
 s.picks.enemy=[{championId:'54',role:'Top'}];
 const ids=[...popularMids,'112','3','61','99','45'];
 s.roleCatalogue!.entries=ids.map((championId,i)=>({championId,role:'Mid',lanePercent:100,pickPercent:10-i/2,games:20000-i*1000}));
 s.dataset.pairs=ids.map((id,i):Pair=>({candidateChampionId:id,candidateRole:'Mid',relation:'vs',otherChampionId:'54',otherRole:'Top',delta2:topFits.includes(id)?10-topFits.indexOf(id):1-i/10,games:10000}));
 return s;
}
