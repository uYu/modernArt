import { writeFileSync } from 'node:fs';
import { actor, applyAction, createGame, observe } from '../src/game/engine.ts';
import { searchAuction } from '../src/game/ai-universal.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';

const rows: {
  count: number;
  mechanism: string;
  evidence: boolean;
  uniformMs: number;
  posteriorMs: number;
  uniformSamples: number;
  posteriorSamples: number;
}[] = [];
for (const count of [3, 4, 5]) {
  let s = createGame(count, 740000 + count);
  while (s.phase !== 'finished') {
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const o = observe(s, actor(s)!);
    if (o.phase === 'offer' || o.phase === 'pair') {
      s = applyAction(s, chooseImprovedAction(o));
      continue;
    }
    const firstPlayed = rows.length % 2 === 0;
    const start = performance.now();
    const first = searchAuction(o, {
      belief: firstPlayed ? 'played' : 'uniform',
    });
    const middle = performance.now();
    const second = searchAuction(o, {
      belief: firstPlayed ? 'uniform' : 'played',
    });
    const end = performance.now();
    const posterior = firstPlayed ? first : second;
    const uniform = firstPlayed ? second : first;
    rows.push({
      count,
      mechanism: `${o.phase}/${o.auction!.type}`,
      evidence: o.publicPlays.some(
        (x) => x.round === o.round && x.player !== o.self.id,
      ),
      uniformMs: firstPlayed ? end - middle : middle - start,
      posteriorMs: firstPlayed ? middle - start : end - middle,
      uniformSamples: uniform.completedSamples,
      posteriorSamples: posterior.completedSamples,
    });
    s = applyAction(s, firstPlayed ? posterior.action : uniform.action);
  }
}
const summarize = (key: 'uniformMs' | 'posteriorMs') => {
  const values = rows.map((x) => x[key]).sort((a, b) => a - b);
  return {
    count: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1),
  };
};
const output = {
  uniform: summarize('uniformMs'),
  posterior: summarize('posteriorMs'),
  evidencePositions: rows.filter((x) => x.evidence).length,
  rows,
};
writeFileSync(
  'experiments/belief-timing.json',
  JSON.stringify(output, null, 2),
);
console.log({
  uniform: output.uniform,
  posterior: output.posterior,
  evidencePositions: output.evidencePositions,
});
