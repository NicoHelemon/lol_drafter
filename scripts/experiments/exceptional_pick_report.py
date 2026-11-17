"""Assemble compact experiment evidence and an exportable chart; offline only."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path('work/exceptional-picks/analysis');OUT=Path('docs/experiments');OUT.mkdir(exist_ok=True)
read=lambda name:json.loads((ROOT/name).read_text())
a=read('initial-results.json');refine=read('refinement-results.json');stress=read('stress-results.json');final=read('final-validation.json');pools=read('visible-pools.json');examples=read('examples.json');roles=list(a['validation'])
report={'scope':'Offline calibration of an exploratory highlight; no site or database writes, no game-outcome validation','snapshot':a['source_snapshot'],'metadata':a['source_metadata'],'k':a['k'],'pairs':a['pairs'],'simulated_drafts':11500,'seeds':{'development':17011,'first_validation':17012,'uniform_stress':17013,'score_biased':17016,'final_validation':17021,'pool_sampling':17030},'rule':{'reference':'All available champions passing the existing 5% role-share filter, not the personal pool','positive':'score>0, score>=role-context q95, score-median >= .5*9/m','negative':'score<0, score<=role-context q05, score-median <= -.5*9/m','m':'Other champions actually present, excluding the target role, 1..9','coverage':'Every currently present contribution must be known for a highlighted candidate; at least 20 eligible reference scores','partial_label':'Always provisional before m=9','rounding':'Use unrounded values'},'threshold_grid':{},'initial_rule_comparison':{},'partial_policy_comparison':{},'final_validation':final,'visible_pools':{},'sensitivity':stress,'examples':examples}
for cut in refine['threshold_grid']['Top']:
 rows=[refine['threshold_grid'][r][cut] for r in roles];totals={k:sum(x[k] for x in rows) for k in ['eligible','positive','negative','roles','positive_roles']};totals['positive_rate']=totals['positive']/totals['eligible'];totals['negative_rate']=totals['negative']/totals['eligible'];report['threshold_grid'][cut]=totals
for rule in a['rules']:
 rows=[a['validation'][r]['rules'][rule] for r in roles];d={k:sum(x[k] for x in rows) for k in ['eligible_candidates','positive','negative','contexts']};d['positive_rate']=d['positive']/d['eligible_candidates'];d['negative_rate']=d['negative']/d['eligible_candidates'];report['initial_rule_comparison'][rule]=d
for m in ['1','3','5','6','7','8','9']:
 report['partial_policy_comparison'][m]={}
 for power in ['0','0.5','1']:
  rows=[refine['partial_and_influence'][r]['partial_policies'][m][power] for r in roles];totals={k:sum(x[k] for x in rows) for k in ['positive','negative','positive_available_denominator','positive_later_unavailable','positive_still_flagged','positive_above_final_median','positive_sign_reversed','negative_still_flagged']};totals['positive_retention']=totals['positive_still_flagged']/max(1,totals['positive']);report['partial_policy_comparison'][m][power]=totals
for mode in pools['Top']:
 rows=[pools[r][mode] for r in roles];d={k:sum(x[k] for x in rows) for k in rows[0]};d['positive_rate']=d['positive']/d['displayed'];d['positive_role_rate']=d['positive_role_cases']/d['contexts'];report['visible_pools'][mode]=d
report['read_only_export']=json.loads(Path('work/exceptional-picks/fetch-summary.json').read_text());report['offrole_sensitivity']=read('offrole.json')
(OUT/'exceptional-pick-calibration-results.json').write_text(json.dumps(report,indent=2)+'\n')
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(1,2,figsize=(11,4.2));cuts=np.array([float(c) for c in report['threshold_grid']]);pos=[100*d['positive_rate'] for d in report['threshold_grid'].values()];neg=[100*d['negative_rate'] for d in report['threshold_grid'].values()]
ax[0].plot(cuts,pos,'o-',label='Perles positives');ax[0].plot(cuts,neg,'o-',label='Fits négatifs');ax[0].axvline(.5,color='black',ls='--',lw=1);ax[0].set_yscale('log');ax[0].set_xlabel('Écart minimal avec la médiane (draft complète)');ax[0].set_ylabel('Candidats signalés (%) — échelle logarithmique');ax[0].set_title('0,5 est déjà un seuil rare');ax[0].legend();ax[0].grid(alpha=.2)
ms=[1,3,5,6,7,8,9]
for power,label in [('0','Seuil constant 0,5'),('1','Seuil adapté : 0,5 × 9 / m')]:
 y=[100*report['partial_policy_comparison'][str(m)][power]['positive_retention'] for m in ms];ax[1].plot(ms,y,'o-',label=label)
ax[1].set_ylim(0,105);ax[1].set_xticks(ms);ax[1].set_xlabel('Autres champions connus (m)');ax[1].set_ylabel('Restent exceptionnels à 9 champions connus (%)');ax[1].set_title('Un signal plus prudent pendant la draft');ax[1].legend();ax[1].grid(alpha=.2)
fig.suptitle('Paires réelles, compositions simulées — aucun taux de victoire mesuré',fontsize=11);fig.tight_layout();fig.savefig(OUT/'exceptional-pick-calibration.png',dpi=170);fig.savefig(OUT/'exceptional-pick-calibration.svg');plt.close(fig)
print('summary and figures saved')
