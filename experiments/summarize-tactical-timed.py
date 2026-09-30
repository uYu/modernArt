"""Cluster on deal seed; do not pool rotated seats as independent samples."""
import hashlib
import itertools
import json
import math
import random
import statistics
import sys
from pathlib import Path

directory, output = map(Path, sys.argv[1:3])
data = [json.loads(p.read_text()) for p in sorted(directory.glob('*.json'))]
assert data and all(d['status'] == 'complete' for d in data), 'incomplete jobs'
hashes = data[0]['hashes']
assert all(d['hashes'] == hashes and d['options'] == data[0]['options'] for d in data), 'source/config mismatch'
assert len({d['pool'] for d in data}) == 1, 'do not pool opponents'
seeds = sorted({d['seed'] for d in data})
assert len(data) == len(seeds)*3 and len({(d['seed'],d['count']) for d in data}) == len(data)
pool = data[0]['pool']
assert pool == 'timed'
expected = list(range(939301,939307))
assert seeds == expected, f'not the full preregistered range: {seeds}'
rows = []
for d in data:
    count = d['count']
    assert count in [3,4,5]
    assert len(d['games']) == count+1
    candidates = [g for g in d['games'] if g['candidate']]
    assert sorted(g['seat'] for g in candidates) == list(range(count))
    for game in candidates:
        seat = game['seat']
        matches = [g for g in d['games'] if not g['candidate'] and g['seat'] is None]
        assert len(matches)==1
        base = matches[0]
        for g in [game,base]:
            high = max(g['cash']); ties = g['cash'].count(high)
            assert g['wins'] == [1/ties if v==high else 0 for v in g['cash']]
        assert all(0 <= x['samples'] <= 8 for x in game['decisions'])
        diffs = [i for i,(a,b) in enumerate(zip(game['actions'],base['actions'])) if a!=b]
        if diffs:
            first = diffs[0]
            assert any(x['index']==first and x['changed'] for x in game['decisions']), 'uncontrolled divergence'
        else:
            assert game['actions']==base['actions']
        rows.append(dict(seed=d['seed'],count=count,seat=seat,candidate=game['wins'][seat],baseline=base['wins'][seat],
                         difference=game['wins'][seat]-base['wins'][seat]))

def interval(values):
    rng=random.Random(20260928)
    n=len(values)
    means=sorted(sum(rng.choices(values,k=n))/n for _ in range(50000))
    return [means[1249],means[48749]]

def sign_p(values):
    observed=abs(sum(values))
    return sum(abs(sum(v*s for v,s in zip(values,signs))) >= observed-1e-12
               for signs in itertools.product([-1,1],repeat=len(values)))/(2**len(values))

groups=[]
clusters={seed:[] for seed in seeds}
for count in [3,4,5]:
    subset=[r for r in rows if r['count']==count]
    values=[]
    for seed in seeds:
        sr=[r for r in subset if r['seed']==seed]
        assert len(sr)==count
        delta=statistics.mean(r['difference'] for r in sr)
        values.append(delta);clusters[seed].append(delta)
    groups.append(dict(count=count,pairs=len(subset),candidate=statistics.mean(r['candidate'] for r in subset),
                       baseline=statistics.mean(r['baseline'] for r in subset),difference=statistics.mean(values),ci95=interval(values)))
values=[statistics.mean(clusters[s]) for s in seeds]
delta=statistics.mean(values);ci=interval(values);p=sign_p(values)
passed=delta>0 and ci[0]>0 and p<.05 and all(g['difference']>=-.05 for g in groups)
decisions=[x for d in data for g in d['games'] for x in g['decisions']]
result=dict(pool=pool,scope='serial product budgets: tactical 1000ms and expert auction 180ms; first expert action cached per identical Observation',
            seeds=seeds,pairs=len(rows),games=sum(len(d['games']) for d in data),hashes=hashes,
            groups=groups,aggregate=dict(weighting='equal player counts, paired by seed and seat',difference=delta,
             candidate=statistics.mean(g['candidate'] for g in groups),baseline=statistics.mean(g['baseline'] for g in groups),
             ci95=ci,twoSidedSignFlipP=p,passed=passed,seedDifferences=dict(zip(seeds,values))),
            decisions=dict(total=len(decisions),changed=sum(x['changed'] for x in decisions),
                           completedSamples=sorted(set(x['samples'] for x in decisions))),
            timing=dict(meanMs=statistics.mean(x['elapsedMs'] for x in decisions),p95Ms=sorted(x['elapsedMs'] for x in decisions)[math.ceil(.95*len(decisions))-1],maxMs=max(x['elapsedMs'] for x in decisions),fallbacks=sum(x['samples']<2 for x in decisions),sampleHistogram={str(i):sum(x['samples']==i for x in decisions) for i in range(9)}),rows=rows)
output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['hashes','rows']},ensure_ascii=False,indent=2))
