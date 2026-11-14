import type {State} from '../domain/types';

export default function StatisticsNote({state}:{state:State}) {
 const {dataset,shrinkage}=state;
 const windowDays=dataset.context?.windowDays ?? 14;
 const k=shrinkage ? shrinkage.k===null?'∞':Number(shrinkage.k.toPrecision(4)).toLocaleString('en-US') : null;
 return <p className="statistics-note" role="note" aria-label="How scores work">
  {dataset.fictional ? 'Fictional demo data.' : <>Data: <a href="https://lolalytics.com/" target="_blank" rel="noreferrer">Lolalytics</a> · last {windowDays} days · {dataset.tier}.</>}{' '}
  {shrinkage ? <>Matchups with fewer games are pulled closer to zero. {dataset.fictional?'Demo':'Learned'} k = {k}{shrinkage.k===null ? ' (no stable effect estimated)' : ' (half the observed advantage at this many games)'}.{' '}
    {!dataset.fictional&&<>Calibration: {new Date(shrinkage.fittedAt).toLocaleDateString('en-GB',{timeZone:'Europe/Zurich'})}; reviewed every 30 days. </>}
    Scores average these adjusted values equally; team scores average selected champions. They are not win probabilities.</>
   : 'Adjusted scores are unavailable until this dataset has a calibration.'}
 </p>;
}
