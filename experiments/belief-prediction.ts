import { writeFileSync } from 'node:fs';
import {
  createGame,
  observe,
  actor,
  applyAction,
  assertState,
} from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { sampleWorld, observationSeed } from '../src/game/ai-planning.ts';
import { beliefWeights, sampleBeliefWorlds } from '../src/game/ai-belief.ts';
import type { GameState, Observation } from '../src/game/types.ts';

const start = Number(process.argv[2] ?? 710001);
const seeds = Number(process.argv[3] ?? 4);
const output = process.argv[4] ?? '/tmp/belief-prediction.json';
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(seeds) || seeds < 1)
  throw new Error('Invalid benchmark seed range');

type Row = {
  seed: number;
  count: number;
  round: number;
  player: number;
  publicOffers: number;
  features: number;
  uniformBrier: number;
  posteriorBrier: number;
  uniformLogLoss: number;
  posteriorLogLoss: number;
  samePoolUniformBrier: number;
  samePoolWeightedBrier: number;
  grid: Record<string, number>;
  uniformMs: number;
  posteriorMs: number;
};
const rows: Row[] = [];
function metric(
  o: Observation,
  actual: GameState,
  worlds: GameState[],
  weights = worlds.map(() => 1 / worlds.length),
) {
  let brier = 0,
    loss = 0,
    n = 0;
  for (const player of actual.players) {
    if (player.id === o.self.id) continue;
    for (let artist = 0; artist < 5; artist++) {
      const truth = Number(player.hand.some((c) => c.artist === artist));
      const probability = worlds.reduce(
        (sum, w, i) =>
          sum +
          (w.players[player.id].hand.some((c) => c.artist === artist)
            ? weights[i]
            : 0),
        0,
      );
      const p = Math.max(1 / 1000, Math.min(999 / 1000, probability));
      brier += (probability - truth) ** 2;
      loss -= truth ? Math.log(p) : Math.log(1 - p);
      n++;
    }
  }
  return { brier: brier / n, logLoss: loss / n, features: n };
}
function evaluate(s: GameState, seed: number, count: number) {
  const id = actor(s)!;
  const o = observe(s, id);
  const hash = observationSeed(o);
  const uniformStart = performance.now();
  const uniform = Array.from({ length: 24 }, (_, i) =>
    sampleWorld(o, (hash + Math.imul(i + 1, 2654435761)) >>> 0),
  );
  const uniformMs = performance.now() - uniformStart;
  const posteriorStart = performance.now();
  const posterior = sampleBeliefWorlds(o, hash, 24, 48).map((x) => x.world);
  const posteriorMs = performance.now() - posteriorStart;
  const pool = Array.from({ length: 48 }, (_, i) =>
    sampleWorld(o, (hash + Math.imul(i + 1, 2654435761)) >>> 0),
  );
  const weights = beliefWeights(o, pool);
  const a = metric(o, s, uniform),
    b = metric(o, s, posterior),
    c = metric(o, s, pool),
    d = metric(o, s, pool, weights);
  const grid = Object.fromEntries(
    [0, 0.1, 0.25, 0.5, 1, 2].map((strength) => [
      strength.toString(),
      metric(o, s, pool, beliefWeights(o, pool, strength)).brier,
    ]),
  );
  rows.push({
    seed,
    count,
    round: s.round,
    player: id,
    publicOffers: o.publicPlays.filter(
      (p) => p.round === o.round && p.phase === 'offer',
    ).length,
    features: a.features,
    uniformBrier: a.brier,
    posteriorBrier: b.brier,
    uniformLogLoss: a.logLoss,
    posteriorLogLoss: b.logLoss,
    samePoolUniformBrier: c.brier,
    samePoolWeightedBrier: d.brier,
    grid,
    uniformMs,
    posteriorMs,
  });
}
for (const count of [3, 4, 5]) {
  for (let offset = 0; offset < seeds; offset++) {
    const seed = start + offset;
    let s = createGame(count, seed, seed % count);
    let eligible = 0,
      steps = 0;
    while (s.phase !== 'finished') {
      if (++steps > 5000) throw new Error('Nontermination');
      if (s.phase === 'roundEnd') {
        s = applyAction(s, { type: 'next' });
        continue;
      }
      const id = actor(s)!;
      if (
        s.phase !== 'offer' &&
        s.phase !== 'pair' &&
        s.publicPlays.some(
          (p) => p.round === s.round && p.phase === 'offer' && p.player !== id,
        )
      ) {
        if (eligible++ % 11 === 0) evaluate(s, seed, count);
      }
      s = applyAction(s, chooseImprovedAction(observe(s, id)));
    }
    assertState(s);
    writeFileSync(output, JSON.stringify({ start, seeds, rows }, null, 2));
    console.log(
      JSON.stringify({
        count,
        seed,
        snapshots: rows.filter((r) => r.count === count && r.seed === seed)
          .length,
      }),
    );
  }
}
const average = (
  key:
    | 'uniformBrier'
    | 'posteriorBrier'
    | 'uniformLogLoss'
    | 'posteriorLogLoss'
    | 'uniformMs'
    | 'posteriorMs',
) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
console.log(
  JSON.stringify({
    snapshots: rows.length,
    uniformBrier: average('uniformBrier'),
    posteriorBrier: average('posteriorBrier'),
    uniformLogLoss: average('uniformLogLoss'),
    posteriorLogLoss: average('posteriorLogLoss'),
    uniformMs: average('uniformMs'),
    posteriorMs: average('posteriorMs'),
  }),
);
