import {ROLES,type Role} from './types';
export const WEIGHTS = Object.fromEntries(ROLES.map(r=>[r,{
 vs:Object.fromEntries(ROLES.map(o=>[o,r==='Top'?(o==='Top'?0.4:0.2):r==='Support'?(['ADC','Support'].includes(o)?0.3:1.1/6):2/9])),
 with:Object.fromEntries(ROLES.filter(o=>o!==r).map(o=>[o,r==='Top'?0.2:r==='Support'?(o==='ADC'?0.3:1.1/6):2/9]))
}])) as Record<Role,Record<'vs'|'with',Partial<Record<Role,number>>>>;
