import type { Pair, ShrinkageModel } from './types';

export function validateModel(raw:unknown):ShrinkageModel {
 const m=raw as ShrinkageModel;
 if(!m || m.method!=='normal-normal-v1' || m.noiseVariance!==2500
   || !Number.isFinite(m.priorVariance) || m.priorVariance<0
   || !(m.k===null ? m.priorVariance===0 : Number.isFinite(m.k)&&m.k>0&&m.priorVariance>0&&Math.abs(m.k*m.priorVariance-2500)<.001)
   || !Number.isFinite(Date.parse(m.fittedAt)) || !(Date.parse(m.reviewAfter)>Date.parse(m.fittedAt))
   || !/^[a-f0-9]{64}$/.test(m.trainingSnapshotId) || !/^[a-f0-9]{64}$/.test(m.contextKey)
   || !Number.isInteger(m.observations) || m.observations<=0
   || !Number.isInteger(m.relationCounts?.vs) || m.relationCounts.vs<=0
   || !Number.isInteger(m.relationCounts?.with) || m.relationCounts.with<=0
   || m.relationCounts.vs+m.relationCounts.with!==m.observations) throw Error('Invalid statistics calibration');
 return m;
}

export function adjustedDelta(pair:Pair|undefined,model:ShrinkageModel|undefined):number|null {
 if(!pair || pair.delta2===null || !model || !Number.isInteger(pair.games) || pair.games!<=0) return null;
 return model.k===null ? 0 : pair.delta2 * (pair.games!/(pair.games!+model.k));
}

// Explicitly illustrative calibration for the fictional local demo only.
export const DEMO_MODEL:ShrinkageModel={method:'normal-normal-v1',k:625,priorVariance:4,noiseVariance:2500,
 fittedAt:'2026-11-14T00:00:00Z',reviewAfter:'2026-12-14T00:00:00Z',trainingSnapshotId:'d'.repeat(64),
 contextKey:'d'.repeat(64),observations:2,relationCounts:{vs:1,with:1}};
