import json, random, statistics
from pathlib import Path

def interval(values, coverage=.95):
    rng=random.Random(20260920)
    boots=sorted(statistics.mean(rng.choices(values,k=len(values))) for _ in range(10000))
    tail=(1-coverage)/2
    return [boots[int(tail*len(boots))],boots[min(len(boots)-1,int((1-tail)*len(boots)))]]
summary=[]
for opponent in ['expert','mixed','hard']:
    path=Path(f'experiments/upgrade-holdout-{opponent}.json')
    d=json.loads(path.read_text())
    rows=d['rows']
    assert len(rows)==d['seeds']*12, f'{path} incomplete'
    assert len({(r['count'],r['seed'],r['seat']) for r in rows})==len(rows)
    groups=[]
    per_seed={seed:[] for seed in range(d['start'],d['start']+d['seeds'])}
    for count in [3,4,5]:
        selected=[r for r in rows if r['count']==count]
        clusters=[]
        for seed in per_seed:
            sr=[r for r in selected if r['seed']==seed]
            assert len(sr)==count
            delta=statistics.mean(r['win']-r['baselineWin'] for r in sr)
            clusters.append(delta);per_seed[seed].append(delta)
        groups.append(dict(count=count,games=len(selected),win=statistics.mean(r['win'] for r in selected),baseline=statistics.mean(r['baselineWin'] for r in selected),difference=statistics.mean(clusters),seedBootstrap95=interval(clusters),bonferroni9=interval(clusters,1-.05/9)))
    clusters=[statistics.mean(v) for v in per_seed.values()]
    summary.append(dict(opponents=opponent,games=len(rows),groups=groups,aggregate=dict(weighting='equal player-count groups',difference=statistics.mean(clusters),primaryInterval975=interval(clusters,.975),seedCount=len(clusters)),timing=d['timing']))
Path('experiments/upgrade-holdout-summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
