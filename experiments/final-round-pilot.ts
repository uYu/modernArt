import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  advanceSimulation,
  applyAction,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { chooseAction as chooseCheapAction } from '../src/game/ai-legacy.ts';
import { searchAuction } from '../src/game/ai-universal.ts';
import type { Action, GameState, Observation } from '../src/game/types.ts';

const seed = Number(process.argv[2] ?? 810001);
const samples = Number(process.argv[3] ?? 4);
const perCount = Number(process.argv[4] ?? 2);
const output = process.argv[5] ?? 'experiments/final-round-pilot.json';
const budgetMs = Number(process.argv[6] ?? 60000);
const staticSamples = Number(process.argv[7] ?? samples);
const gamesPerCount = Number(process.argv[8] ?? 1);
const weightedEnabled = process.argv[9] !== 'skip-weighted';
const terminalEvaluation =
  process.argv[10] === 'final-win' ? 'final-win' : 'final-round';
const pivotalGap =
  process.argv[11] === undefined ? null : Number(process.argv[11]);
const anchorToStatic = process.argv[12] === 'anchor-static';
const staticBudgetMs = Number(process.argv[13] ?? budgetMs);
if (
  !Number.isSafeInteger(seed) ||
  seed < 0 ||
  !Number.isSafeInteger(samples) ||
  samples < 1 ||
  !Number.isSafeInteger(perCount) ||
  perCount < 1 ||
  !Number.isFinite(budgetMs) ||
  budgetMs <= 0 ||
  !Number.isSafeInteger(staticSamples) ||
  staticSamples < 1 ||
  !Number.isSafeInteger(gamesPerCount) ||
  gamesPerCount < 1 ||
  (pivotalGap !== null && (!Number.isFinite(pivotalGap) || pivotalGap < 0)) ||
  !Number.isFinite(staticBudgetMs) ||
  staticBudgetMs <= 0
)
  throw new Error(
    'Expected: [seed] [terminal samples] [positions per game] [output] [budget ms] [static samples] [games per player count]',
  );

const positions: {
  count: number;
  gameSeed: number;
  observation: Observation;
  state: GameState;
}[] = [];
for (const count of [3, 4, 5]) {
  for (let game = 0; game < gamesPerCount; game++) {
    const gameSeed = seed + count + game * 17;
    let state = createGame(count, gameSeed, gameSeed % count);
    let collected = 0;
    while (state.phase !== 'finished') {
      if (state.phase === 'roundEnd') {
        state = applyAction(state, { type: 'next' });
        continue;
      }
      const observation = observe(state, actor(state)!);
      if (
        observation.round === 4 &&
        observation.phase !== 'offer' &&
        observation.phase !== 'pair' &&
        Math.max(...observation.counts) >= 4 &&
        collected < perCount
      ) {
        positions.push({
          count,
          gameSeed,
          observation,
          state: structuredClone(state),
        });
        collected++;
      }
      state = applyAction(state, chooseImprovedAction(observation));
    }
  }
}

function actualWorldOutcome(
  state: GameState,
  action: Action,
): { margin: number; winShare: number; gap: number } {
  const world = structuredClone(state);
  const me = actor(world)!;
  advanceSimulation(world, action);
  let steps = 0;
  // Match the simulated continuation's neutral style for the current auction.
  while (world.auction) {
    if (++steps > 300)
      throw new Error('Actual-world auction did not terminate');
    advanceSimulation(
      world,
      chooseImprovedAction(observe(world, actor(world)!)),
    );
  }
  while (world.phase !== 'roundEnd') {
    if (++steps > 300) throw new Error('Actual-world season did not terminate');
    advanceSimulation(world, chooseCheapAction(observe(world, actor(world)!)));
  }
  const cash = world.players.map((p) => p.cash);
  const best = Math.max(...cash);
  return {
    margin: cash[me] - 0.8 * Math.max(...cash.filter((_, i) => i !== me)),
    winShare: cash[me] === best ? 1 / cash.filter((c) => c === best).length : 0,
    gap: cash[me] - Math.max(...cash.filter((_, i) => i !== me)),
  };
}

// Optional stress-test selection uses the true state only offline, before
// measuring actions. It is never supplied to searchAuction at runtime.
const selectedPositions =
  pivotalGap === null
    ? positions
    : positions.filter(
        ({ state, observation }) =>
          Math.abs(
            actualWorldOutcome(state, chooseImprovedAction(observation)).gap,
          ) <= pivotalGap,
      );
if (!selectedPositions.length)
  throw new Error('No diagnostic positions met the filter');
const rows = selectedPositions.map(
  ({ count, gameSeed, observation, state }) => {
    // A and B reuse the same sampled worlds and candidates. C changes only the
    // world distribution. A short budget may produce different completed world
    // counts, so use those runs for timing rather than paired value estimates.
    const run = (
      evaluation: 'auction' | 'final-round' | 'final-win',
      belief: 'uniform' | 'weighted',
      reference?: Action,
    ) =>
      searchAuction(observation, {
        evaluation,
        belief,
        samples: evaluation === 'auction' ? staticSamples : samples,
        budgetMs: evaluation === 'auction' ? staticBudgetMs : budgetMs,
        reference,
      });
    const staticUniform = run('auction', 'uniform');
    const reference = anchorToStatic ? staticUniform.action : undefined;
    const terminalUniform = run(terminalEvaluation, 'uniform', reference);
    const terminalWeighted = weightedEnabled
      ? run(terminalEvaluation, 'weighted', reference)
      : terminalUniform;
    const trueWorldOutcomes = Object.fromEntries(
      (
        [
          ['staticUniform', staticUniform],
          ['terminalUniform', terminalUniform],
          ['terminalWeighted', terminalWeighted],
        ] as const
      ).map(([name, result]) => [
        name,
        actualWorldOutcome(state, result.action),
      ]),
    ) as Record<
      'staticUniform' | 'terminalUniform' | 'terminalWeighted',
      { margin: number; winShare: number; gap: number }
    >;
    const trueWorldContinuationScores = Object.fromEntries(
      Object.entries(trueWorldOutcomes).map(([name, outcome]) => [
        name,
        outcome.margin,
      ]),
    ) as Record<
      'staticUniform' | 'terminalUniform' | 'terminalWeighted',
      number
    >;
    const trueWorldWinShares = Object.fromEntries(
      Object.entries(trueWorldOutcomes).map(([name, outcome]) => [
        name,
        outcome.winShare,
      ]),
    ) as Record<
      'staticUniform' | 'terminalUniform' | 'terminalWeighted',
      number
    >;
    return {
      count,
      gameSeed,
      round: observation.round,
      phase: observation.phase,
      mechanism: observation.auction!.type,
      counts: observation.counts,
      handCounts: observation.players.map((p) => p.handCount),
      evidence: observation.publicPlays.some(
        (event) =>
          event.round === observation.round &&
          event.player !== observation.self.id,
      ),
      trueWorldContinuationScores,
      trueWorldWinShares,
      modes: { staticUniform, terminalUniform, terminalWeighted },
    };
  },
);
const hashes = Object.fromEntries(
  [
    'experiments/final-round-pilot.ts',
    'src/game/ai-universal.ts',
    'src/game/ai-planning.ts',
    'src/game/ai-belief.ts',
    'src/game/ai-improved.ts',
    'src/game/ai-legacy.ts',
    'src/game/engine.ts',
  ].map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
const summary = {
  positions: rows.length,
  byCount: [3, 4, 5].map((count) => ({
    count,
    positions: rows.filter((row) => row.count === count).length,
  })),
  actionChangesFromStatic: rows.filter(
    (row) =>
      JSON.stringify(row.modes.staticUniform.action) !==
      JSON.stringify(row.modes.terminalUniform.action),
  ).length,
  weightChangesFromUniform: rows.filter(
    (row) =>
      JSON.stringify(row.modes.terminalUniform.action) !==
      JSON.stringify(row.modes.terminalWeighted.action),
  ).length,
  trueWorldContinuationDeltas: Object.fromEntries(
    [
      ['terminalUniform', 'staticUniform'],
      ['terminalWeighted', 'terminalUniform'],
    ].map(([candidate, baseline]) => {
      const deltas = rows.map(
        (row) =>
          row.trueWorldContinuationScores[
            candidate as keyof typeof row.trueWorldContinuationScores
          ] -
          row.trueWorldContinuationScores[
            baseline as keyof typeof row.trueWorldContinuationScores
          ],
      );
      return [
        `${candidate}Vs${baseline}`,
        {
          mean: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
          better: deltas.filter((value) => value > 0).length,
          worse: deltas.filter((value) => value < 0).length,
          tied: deltas.filter((value) => value === 0).length,
        },
      ];
    }),
  ),
  trueWorldWinDeltas: Object.fromEntries(
    [
      ['terminalUniform', 'staticUniform'],
      ['terminalWeighted', 'terminalUniform'],
    ].map(([candidate, baseline]) => {
      const deltas = rows.map(
        (row) =>
          row.trueWorldWinShares[
            candidate as keyof typeof row.trueWorldWinShares
          ] -
          row.trueWorldWinShares[
            baseline as keyof typeof row.trueWorldWinShares
          ],
      );
      return [
        `${candidate}Vs${baseline}`,
        {
          mean: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
          better: deltas.filter((value) => value > 0).length,
          worse: deltas.filter((value) => value < 0).length,
          tied: deltas.filter((value) => value === 0).length,
        },
      ];
    }),
  ),
  meanMs: Object.fromEntries(
    (['staticUniform', 'terminalUniform', 'terminalWeighted'] as const).map(
      (mode) => [
        mode,
        rows.reduce((sum, row) => sum + row.modes[mode].elapsedMs, 0) /
          Math.max(1, rows.length),
      ],
    ),
  ),
  meanSamples: Object.fromEntries(
    (['staticUniform', 'terminalUniform', 'terminalWeighted'] as const).map(
      (mode) => [
        mode,
        rows.reduce((sum, row) => sum + row.modes[mode].completedSamples, 0) /
          Math.max(1, rows.length),
      ],
    ),
  ),
};
writeFileSync(
  output,
  JSON.stringify(
    {
      seed,
      samples,
      staticSamples,
      gamesPerCount,
      weightedEnabled,
      terminalEvaluation,
      pivotalGap,
      anchorToStatic,
      staticBudgetMs,
      candidatePositions: positions.length,
      perCount,
      budgetMs,
      runtime: process.version,
      hashes,
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.log(summary);
