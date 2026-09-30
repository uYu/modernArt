import { readFileSync, writeFileSync } from 'node:fs';
import { actor, applyAction, createGame } from '../src/game/engine.ts';
import type { Action } from '../src/game/types.ts';

// Audit saved actions, not re-running time-budgeted policies: identical seeds
// alone do not guarantee that the reference search made identical decisions.
const input = process.argv[2] ?? 'experiments/tactical-pilot-928101.json';
const data = JSON.parse(readFileSync(input, 'utf8')) as {
  rows: {
    seed: number;
    count: number;
    seat: number | null;
    actions: Action[];
  }[];
};
const rows = data.rows
  .filter((r) => r.seat !== null)
  .map((r) => {
    const base = data.rows.find(
      (b) => b.seed === r.seed && b.count === r.count && b.seat === null,
    );
    if (!base) throw new Error('Missing paired baseline');
    let firstDifference = 0;
    while (
      firstDifference < Math.min(base.actions.length, r.actions.length) &&
      JSON.stringify(base.actions[firstDifference]) ===
        JSON.stringify(r.actions[firstDifference])
    )
      firstDifference++;
    let s = createGame(r.count, r.seed, r.seed % r.count);
    for (const action of base.actions.slice(0, firstDifference))
      s = applyAction(s, action);
    const same =
      firstDifference === base.actions.length &&
      firstDifference === r.actions.length;
    const startsAtExperimentalChoice =
      !same &&
      actor(s) === r.seat &&
      (s.phase === 'offer' || s.phase === 'pair');
    return {
      seed: r.seed,
      count: r.count,
      seat: r.seat,
      firstDifference: same ? null : firstDifference,
      round: s.round,
      phase: s.phase,
      actor: actor(s),
      baseline: base.actions[firstDifference] ?? null,
      candidate: r.actions[firstDifference] ?? null,
      startsAtExperimentalChoice,
      referenceDriftBeforeExperimentalChoice:
        !same && !startsAtExperimentalChoice,
    };
  });
const result = {
  input,
  pairs: rows.length,
  referenceDriftPairs: rows.filter(
    (r) => r.referenceDriftBeforeExperimentalChoice,
  ).length,
  interpretation:
    'Runtime pilot only. Reference drift and one development seed prevent a causal strength claim.',
  rows,
};
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
