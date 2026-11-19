import type {Pair,ShrinkageModel} from './types';
import {adjustedDelta} from './shrinkage';

// Shrink each original direction independently. Missing directions contribute
// zero before consolidation; null still identifies an entirely unobserved pair.
export function consolidatedInteraction(forward:Pair|undefined,reverse:Pair|undefined,model:ShrinkageModel|undefined){
 const a=adjustedDelta(forward,model),b=adjustedDelta(reverse,model);
 const directions=Number(a!==null)+Number(b!==null);
 const relation=forward?.relation??reverse?.relation;
 return {value:directions?((a??0)+(relation==='vs'?-(b??0):(b??0)))/2:null,
  forward:a,reverse:b,directions};
}
