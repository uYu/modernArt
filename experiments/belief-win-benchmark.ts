import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import {
  chooseUniversalAction,
  searchAuction,
} from '../src/game/ai-universal.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import type { Action, Observation } from '../src/game/types.ts';

const start = Number(process.argv[2] ?? 730001);
const seeds = Number(process.argv[3] ?? 12);
const output = process.argv[4] ?? '/tmp/belief-win-benchmark.json';
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(seeds) || seeds < 1)
  throw new Error('Invalid benchmark seed range');
const files = [
  'ai-belief',
  'ai-universal',
  'ai-planning',
  'ai-improved',
  'ai-search',
  'ai-legacy',
  'engine',
  'types',
].map((name) => `src/game/${name}.ts`);
const hashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
type Row = {
  count: number;
  seed: number;
  seat: number;
  candidateWin: number;
  baselineWin: number;
  candidateCash: number[];
  baselineCash: number[];
};
const rows: Row[] = [];
const timing: {
  ms: number;
  samples: number;
  changed: boolean;
  evidence: boolean;
}[] = [];
function win(cash: number[], seat: number) {
  const top = Math.max(...cash);
  return cash[seat] === top ? 1 / cash.filter((x) => x === top).length : 0;
}
function focal(o: Observation): Action {
  if (o.phase === 'offer' || o.phase === 'pair') return chooseImprovedAction(o);
  const started = performance.now();
  const result = searchAuction(o, { belief: 'played' });
  timing.push({
    ms: performance.now() - started,
    samples: result.completedSamples,
    changed: JSON.stringify(result.action) !== JSON.stringify(result.reference),
    evidence: o.publicPlays.some(
      (x) => x.round === o.round && x.player !== o.self.id,
    ),
  });
  return result.action;
}
function run(count: number, seed: number, seat: number | null) {
  let s = createGame(count, seed, seed % count);
  let steps = 0;
  while (s.phase !== 'finished') {
    if (++steps > 5000) throw new Error('Nontermination');
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const id = actor(s)!;
    const o = observe(s, id);
    s = applyAction(s, id === seat ? focal(o) : chooseUniversalAction(o));
  }
  assertState(s);
  return s.players.map((p) => p.cash);
}
for (const count of [3, 4, 5]) {
  for (let offset = 0; offset < seeds; offset++) {
    const seed = start + offset;
    const baselineCash = run(count, seed, null);
    for (let seat = 0; seat < count; seat++) {
      const candidateCash = run(count, seed, seat);
      rows.push({
        count,
        seed,
        seat,
        candidateWin: win(candidateCash, seat),
        baselineWin: win(baselineCash, seat),
        candidateCash,
        baselineCash,
      });
    }
    writeFileSync(
      output,
      JSON.stringify({ start, seeds, hashes, rows, timing }, null, 2),
    );
    console.log(JSON.stringify({ count, seed, games: rows.length }));
  }
}
for (const count of [3, 4, 5]) {
  const group = rows.filter((x) => x.count === count);
  console.log(
    JSON.stringify({
      count,
      games: group.length,
      candidate: group.reduce((s, x) => s + x.candidateWin, 0) / group.length,
      baseline: group.reduce((s, x) => s + x.baselineWin, 0) / group.length,
    }),
  );
}
