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
import type { Action, Observation } from '../src/game/types.ts';

const start = Number(process.argv[2] ?? 814101);
const seeds = Number(process.argv[3] ?? 1);
const samples = Number(process.argv[4] ?? 256);
const output = process.argv[5] ?? 'experiments/final-win-game-pilot.json';
if (
  !Number.isSafeInteger(start) ||
  start < 0 ||
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  !Number.isSafeInteger(samples) ||
  samples < 1
)
  throw new Error('Expected: [start seed] [seed count] [samples] [output]');
const hashes = Object.fromEntries(
  [
    'experiments/final-win-game-benchmark.ts',
    'src/game/ai-universal.ts',
    'src/game/ai-planning.ts',
    'src/game/ai-improved.ts',
    'src/game/ai-legacy.ts',
    'src/game/engine.ts',
  ].map((path) => [
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
  deepDecisions: number;
};
const rows: Row[] = [];
const timing: {
  count: number;
  seed: number;
  seat: number;
  phase: string;
  mechanism: string;
  ms: number;
  completedSamples: number;
}[] = [];
function win(cash: number[], seat: number): number {
  const best = Math.max(...cash);
  return cash[seat] === best ? 1 / cash.filter((x) => x === best).length : 0;
}
function focal(
  o: Observation,
  count: number,
  seed: number,
  seat: number,
): Action {
  if (
    o.round !== 4 ||
    o.phase === 'offer' ||
    o.phase === 'pair' ||
    Math.max(...o.counts) < 4
  )
    return chooseUniversalAction(o);
  // Anchor the deep candidate set and weak-evidence fallback to the current
  // proven expert, rather than the earlier auction policy.
  const baseline = chooseUniversalAction(o);
  const result = searchAuction(o, {
    evaluation: 'final-win',
    samples,
    budgetMs: 120000,
    reference: baseline,
  });
  timing.push({
    count,
    seed,
    seat,
    phase: o.phase,
    mechanism: o.auction!.type,
    ms: result.elapsedMs,
    completedSamples: result.completedSamples,
  });
  return result.action;
}
function run(count: number, seed: number, seat: number | null): number[] {
  let state = createGame(count, seed, seed % count);
  let steps = 0;
  while (state.phase !== 'finished') {
    if (++steps > 5000) throw new Error('Game did not terminate');
    if (state.phase === 'roundEnd') {
      state = applyAction(state, { type: 'next' });
      continue;
    }
    const id = actor(state)!;
    const o = observe(state, id);
    state = applyAction(
      state,
      id === seat ? focal(o, count, seed, seat) : chooseUniversalAction(o),
    );
  }
  assertState(state);
  return state.players.map((p) => p.cash);
}
for (const count of [3, 4, 5])
  for (let offset = 0; offset < seeds; offset++) {
    const seed = start + offset;
    const baselineCash = run(count, seed, null);
    for (let seat = 0; seat < count; seat++) {
      const before = timing.length;
      const candidateCash = run(count, seed, seat);
      rows.push({
        count,
        seed,
        seat,
        candidateWin: win(candidateCash, seat),
        baselineWin: win(baselineCash, seat),
        candidateCash,
        baselineCash,
        deepDecisions: timing.length - before,
      });
    }
    writeFileSync(
      output,
      JSON.stringify({ start, seeds, samples, hashes, rows, timing }, null, 2),
    );
    console.log(JSON.stringify({ count, seed, games: rows.length }));
  }
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
console.log({
  games: rows.length,
  decisions: timing.length,
  candidateWin: mean(rows.map((row) => row.candidateWin)),
  baselineWin: mean(rows.map((row) => row.baselineWin)),
  meanDecisionMs: timing.length ? mean(timing.map((row) => row.ms)) : 0,
});
