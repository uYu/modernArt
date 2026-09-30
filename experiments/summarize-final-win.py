"""Summarize a complete high-budget final-win game benchmark by deal seed."""

import json
import itertools
import random
import statistics
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "experiments/final-win-game-holdout-815101.json"
with open(path, encoding="utf-8") as file:
    data = json.load(file)

seeds = list(range(data["start"], data["start"] + data["seeds"]))
expected = {(count, seed, seat) for count in (3, 4, 5) for seed in seeds for seat in range(count)}
actual = {(row["count"], row["seed"], row["seat"]) for row in data["rows"]}
if len(data["rows"]) != len(expected) or actual != expected:
    raise ValueError(f"Incomplete or duplicate benchmark: {len(data['rows'])}/{len(expected)} rows")

by_key = {(row["count"], row["seed"], row["seat"]): row for row in data["rows"]}
seed_differences = {}
for seed in seeds:
    by_count = {}
    for count in (3, 4, 5):
        rows = [by_key[count, seed, seat] for seat in range(count)]
        by_count[count] = statistics.mean(
            row["candidateWin"] - row["baselineWin"] for row in rows
        )
    seed_differences[seed] = statistics.mean(by_count.values())

rng = random.Random(815101)
draws = sorted(
    statistics.mean(seed_differences[rng.choice(seeds)] for _ in seeds)
    for _ in range(20_000)
)
nonzero = [difference for difference in seed_differences.values() if difference != 0]
observed_total = abs(sum(nonzero))
flipped_totals = [
    abs(sum(sign * difference for sign, difference in zip(signs, nonzero)))
    for signs in itertools.product((-1, 1), repeat=len(nonzero))
]
sign_flip_p = (
    sum(value >= observed_total - 1e-12 for value in flipped_totals)
    / len(flipped_totals)
    if flipped_totals
    else 1.0
)
timings = sorted(row["ms"] for row in data["timing"])
summary = {
    "seeds": seeds,
    "games": len(data["rows"]),
    "decisionCount": len(timings),
    "perSeedEqualCountDifference": seed_differences,
    "equalCountDifference": statistics.mean(seed_differences.values()),
    "clusterBootstrap95": [draws[500], draws[19_499]],
    "exactTwoSidedSeedSignFlipP": sign_flip_p,
    "byCount": {
        count: {
            "candidate": statistics.mean(
                row["candidateWin"] for row in data["rows"] if row["count"] == count
            ),
            "baseline": statistics.mean(
                row["baselineWin"] for row in data["rows"] if row["count"] == count
            ),
        }
        for count in (3, 4, 5)
    },
    "decisionMs": {
        "mean": statistics.mean(timings) if timings else 0,
        "p95": timings[min(len(timings) - 1, int(0.95 * len(timings)))] if timings else 0,
        "max": timings[-1] if timings else 0,
    },
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
