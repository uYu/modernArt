import json, random, statistics
from pathlib import Path

def ci(values, coverage=.975):
    rng=random.Random(20260923)
    count=len(values)
    samples=sorted(statistics.mean(rng.choices(values,k=count)) for _ in range(10000))
    tail=(1-coverage)/2
    return [samples[int(tail*len(samples))],samples[min(len(samples)-1,int((1-tail)*len(samples)))]]

output=[]
for opponent in ['expert','mixed','hard']:
    path=Path(f'experiments/universal-holdout-{opponent}.json')
    if not path.exists():continue
    data=json.loads(path.read_text())
    rows=data['rows']
    assert len(rows)==data['seeds']*12,f'{path} incomplete'
    assert len({(r['count'],r['seed'],r['seat']) for r in rows})==len(rows)
    by_seed={s:[] for s in range(data['start'],data['start']+data['seeds'])}
    groups=[]
    for count in [3,4,5]:
        group=[r for r in rows if r['count']==count]
        values=[]
        for seed in by_seed:
            sr=[r for r in group if r['seed']==seed]
            assert len(sr)==count
            delta=statistics.mean(r['candidateWin']-r['baselineWin'] for r in sr)
            values.append(delta);by_seed[seed].append(delta)
        groups.append(dict(count=count,games=len(group),candidate=statistics.mean(r['candidateWin'] for r in group),baseline=statistics.mean(r['baselineWin'] for r in group),difference=statistics.mean(values),ci95=ci(values,.95)))
    values=[statistics.mean(x) for x in by_seed.values()]
    output.append(dict(opponents=opponent,groups=groups,aggregate=dict(weighting='equal player counts',difference=statistics.mean(values),ci975=ci(values),seeds=len(values)),phaseStats=data.get('phaseStats',{}),timing=data['timing']))
Path('experiments/universal-holdout-summary.json').write_text(json.dumps(output,indent=2))
print(json.dumps(output,indent=2))
