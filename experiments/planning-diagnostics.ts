import { writeFileSync } from 'node:fs';
import { createGame, observe } from '../src/game/engine.ts';
import { plan } from '../src/game/ai-planning.ts';
const rows = [];
for (const count of [3, 4, 5])
  for (const iterations of [48, 96, 384]) {
    const result = plan(observe(createGame(count, 410000 + count), 0), {
      mode: 'ismcts',
      iterations,
    });
    const visits = result.candidates.map((c) => c.visits);
    rows.push({
      count,
      iterations,
      actions: visits.length,
      minVisits: Math.min(...visits),
      maxVisits: Math.max(...visits),
      treeNodes: result.treeNodes,
      treeSelections: result.treeSelections,
      treeRevisits: result.treeRevisits,
      elapsedMs: result.elapsedMs,
    });
  }
writeFileSync(
  'experiments/planning-diagnostics.json',
  JSON.stringify(rows, null, 2),
);
console.log(JSON.stringify(rows));
