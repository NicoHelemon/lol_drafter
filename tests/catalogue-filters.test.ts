import {it,expect} from 'vitest';
import {catalogueChoices,validateCatalogue} from '../src/domain/catalogue';
import {initialState,champions,championIds} from '../src/data/provider';
it('uses champion role share for filtering, observed games for popularity and preserves selected off-role champions',()=>{
 const c=initialState('p','P').roleCatalogue!;
 c.entries=[{championId:'58',role:'Top',lanePercent:95,pickPercent:6,games:1000},{championId:'103',role:'Top',lanePercent:1,pickPercent:.1,games:20},{championId:'164',role:'Top',lanePercent:70,pickPercent:3,games:500}];
 const opts={role:'Top' as const,sort:'popularity' as const,query:'',pinned:[] as string[]};
 expect(catalogueChoices(champions,c,opts).map(c=>c.id)).toEqual(['58','164']);
 expect(catalogueChoices(champions,c,{...opts,pinned:['103']}).map(c=>c.id)).toEqual(['58','164','103']);
 expect(catalogueChoices(champions,c,{...opts,query:'cam'}).map(c=>c.id)).toEqual(['164']);
 expect(catalogueChoices(champions,c,{...opts,sort:'alphabetical'}).map(c=>c.id)).toEqual(['164','58']);
 expect(catalogueChoices(champions,undefined,opts)).toHaveLength(champions.length);
});
it('validates measured role data without inventing missing values or accepting duplicates',()=>{
 const c=initialState('p','P').roleCatalogue!;expect(validateCatalogue(c,championIds)).toBe(c);
 expect(()=>validateCatalogue({...c,entries:[c.entries[0],c.entries[0]]},championIds)).toThrow('catalogue');
 expect(()=>validateCatalogue({...c,entries:[{...c.entries[0],games:-1}]},championIds)).toThrow('catalogue');
});
