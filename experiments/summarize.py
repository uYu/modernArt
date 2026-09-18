"""Paired bootstrap over deal seeds, keeping all seats of a seed together."""
import json, random, sys
from pathlib import Path
for name in sys.argv[1:]:
    data=json.loads(Path(name).read_text())
    summary=[]
    for count in (3,4,5):
        rows=[r for r in data['rows'] if r['count']==count]
        seeds=sorted({r['seed'] for r in rows})
        groups=[[r for r in rows if r['seed']==s] for s in seeds]
        deltas=[sum(r['win']-r['baselineWin'] for r in group)/len(group) for group in groups]
        rng=random.Random(90317)
        boot=sorted(sum(rng.choice(deltas) for _ in deltas)/len(deltas) for _ in range(5000))
        result={'players':count,'games':len(rows),'winRate':sum(r['win'] for r in rows)/len(rows),
                'baseline':sum(r['baselineWin'] for r in rows)/len(rows),
                'difference':sum(deltas)/len(deltas),'pairedSeedBootstrap95':[boot[125],boot[4874]],
                'meanCash':sum(r['cash'][r['seat']] for r in rows)/len(rows),
                'baselineMeanCash':sum(r['baselineCash'][r['seat']] for r in rows)/len(rows)}
        summary.append(result)
    dest=Path(name).with_suffix('.summary.json')
    dest.write_text(json.dumps({'input':name,'version':data['version'],'timing':data['timing'],'groups':summary},indent=2)+'\n')
    print(dest, json.dumps(summary))
