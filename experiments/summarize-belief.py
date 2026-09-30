import json
import random
import statistics
from pathlib import Path

prediction = json.loads(Path('experiments/belief-prediction-holdout.json').read_text())
wins = json.loads(Path('experiments/belief-win-holdout.json').read_text())
pred_rows = prediction['rows']
win_rows = wins['rows']
seeds = list(range(720001, 720013))
win_seeds = list(range(730001, 730013))
assert all(any(row['seed'] == seed and row['count'] == count for row in pred_rows)
           for seed in seeds for count in (3, 4, 5))
assert len(win_rows) == 12 * (3 + 4 + 5)
assert all(sum(row['seed'] == seed and row['count'] == count for row in win_rows) == count
           for seed in win_seeds for count in (3, 4, 5))

def bootstrap(values, draws=10000):
    rng = random.Random(230923)
    samples = sorted(statistics.mean(rng.choices(values, k=len(values))) for _ in range(draws))
    return [samples[int(draws * .025)], samples[int(draws * .975)]]

def pred_seed(seed, metric):
    group = [x for x in pred_rows if x['seed'] == seed]
    before = 'uniform' + metric
    after = 'posterior' + metric
    return sum((x[after] - x[before]) * x['features'] for x in group) / sum(x['features'] for x in group)

def win_seed(seed):
    return statistics.mean(
        statistics.mean(x['candidateWin'] - x['baselineWin'] for x in win_rows
                        if x['seed'] == seed and x['count'] == count)
        for count in (3, 4, 5)
    )

def group_result(count):
    group = [x for x in win_rows if x['count'] == count]
    return {
        'count': count,
        'games': len(group),
        'candidateWinShare': statistics.mean(x['candidateWin'] for x in group),
        'baselineWinShare': statistics.mean(x['baselineWin'] for x in group),
        'difference': statistics.mean(x['candidateWin'] - x['baselineWin'] for x in group),
    }

timing = wins['timing']
times = sorted(x['ms'] for x in timing)
result = {
    'prediction': {
        'seeds': len(seeds),
        'snapshots': len(pred_rows),
        'features': sum(x['features'] for x in pred_rows),
        'uniformBrier': sum(x['uniformBrier'] * x['features'] for x in pred_rows) / sum(x['features'] for x in pred_rows),
        'posteriorBrier': sum(x['posteriorBrier'] * x['features'] for x in pred_rows) / sum(x['features'] for x in pred_rows),
        'brierDifference': statistics.mean(pred_seed(s, 'Brier') for s in seeds),
        'brierDifferenceCi95': bootstrap([pred_seed(s, 'Brier') for s in seeds]),
        'logLossDifference': statistics.mean(pred_seed(s, 'LogLoss') for s in seeds),
        'logLossDifferenceCi95': bootstrap([pred_seed(s, 'LogLoss') for s in seeds]),
    },
    'wins': {
        'seeds': len(win_seeds),
        'groups': [group_result(c) for c in (3, 4, 5)],
        'equalCountDifference': statistics.mean(win_seed(s) for s in win_seeds),
        'differenceCi95': bootstrap([win_seed(s) for s in win_seeds]),
    },
    'timing': {
        'decisions': len(times),
        'meanMs': statistics.mean(times),
        'p95Ms': times[int(.95 * len(times))],
        'maxMs': times[-1],
        'meanSamples': statistics.mean(x['samples'] for x in timing),
        'evidenceFraction': statistics.mean(x['evidence'] for x in timing),
    },
}
Path('experiments/belief-holdout-summary.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(result, indent=2, ensure_ascii=False))
