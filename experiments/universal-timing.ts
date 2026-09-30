import { writeFileSync } from 'node:fs';
import { createGame, observe, actor, applyAction } from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { searchAuction } from '../src/game/ai-universal.ts';
const rows: {
  count: number;
  mechanism: string;
  expertMs: number;
  searchMs: number;
  samples: number;
  changed: boolean;
}[] = [];
for (const count of [3, 4, 5]) {
  let s = createGame(count, 650000 + count);
  while (s.phase !== 'finished') {
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const o = observe(s, actor(s)!);
    const start = performance.now();
    const base = chooseImprovedAction(o);
    const middle = performance.now();
    const result =
      o.phase === 'offer' || o.phase === 'pair' ? null : searchAuction(o);
    const finish = performance.now();
    if (result)
      rows.push({
        count,
        mechanism: `${o.phase}/${o.auction?.type}`,
        expertMs: middle - start,
        searchMs: finish - middle,
        samples: result.completedSamples,
        changed: JSON.stringify(result.action) !== JSON.stringify(base),
      });
    s = applyAction(s, rows.length % 2 && result ? result.action : base);
  }
}
const summary = Object.fromEntries(
  ['expertMs', 'searchMs'].map((key) => {
    const values = rows
      .map((r) => r[key as 'expertMs' | 'searchMs'])
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
  'experiments/universal-timing.json',
  JSON.stringify({ runtime: process.version, summary, rows }, null, 2),
);
console.log(summary);
