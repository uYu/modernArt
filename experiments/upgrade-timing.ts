import { writeFileSync } from 'node:fs';
import { createGame, observe, actor, applyAction } from '../src/game/engine.ts';
import { chooseAction as baseline } from '../src/game/ai-expert-baseline.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
const rows: {
  count: number;
  phase: string;
  baselineMs: number;
  upgradedMs: number;
}[] = [];
for (const count of [3, 4, 5]) {
  let s = createGame(count, 540000 + count);
  while (s.phase !== 'finished') {
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const o = observe(s, actor(s)!);
    const start = performance.now();
    const old = baseline(o);
    const middle = performance.now();
    const next = chooseImprovedAction(o);
    const end = performance.now();
    rows.push({
      count,
      phase: `${o.phase}/${o.auction?.type ?? 'none'}`,
      baselineMs: middle - start,
      upgradedMs: end - middle,
    });
    // Both policies see the exact same observed position. Alternate which policy
    // advances this diagnostic trajectory; this is not a strength experiment.
    s = applyAction(s, rows.length % 2 ? next : old);
  }
}
const summary = Object.fromEntries(
  ['baselineMs', 'upgradedMs'].map((key) => {
    const values = rows
      .map((r) => r[key as 'baselineMs' | 'upgradedMs'])
      .sort((a, b) => a - b);
    return [
      key,
      {
        n: values.length,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p95: values[Math.floor(values.length * 0.95)],
        max: values.at(-1),
      },
    ];
  }),
);
writeFileSync(
  'experiments/upgrade-timing.json',
  JSON.stringify({ runtime: process.version, summary, rows }, null, 2),
);
console.log(summary);
