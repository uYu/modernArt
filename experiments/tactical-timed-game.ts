import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { searchAuction } from '../src/game/ai-universal.ts';
import {
  searchTacticalOffer,
  TACTICAL_VERSION,
} from '../src/game/ai-tactical.ts';
import type { Action, Observation } from '../src/game/types.ts';

const [pool, seedText, countText, output] = process.argv.slice(2);
const seed = Number(seedText),
  count = Number(countText);
if (
  pool !== 'timed' ||
  !Number.isSafeInteger(seed) ||
  ![3, 4, 5].includes(count) ||
  !output
)
  throw new Error('Usage: pool seed count output');
const files = [
  'engine',
  'types',
  'data',
  'ledger',
  'ai',
  'ai-legacy',
  'ai-search',
  'ai-expert-baseline',
  'ai-improved',
  'ai-universal',
  'ai-planning',
  'ai-belief',
  'ai-tactical',
].map((name) => `src/game/${name}.ts`);
files.push(
  'experiments/tactical-holdout-game.ts',
  'experiments/tactical-holdout-run.ts',
  'experiments/summarize-tactical.py',
  'experiments/tactical-holdout-plan.md',
  'experiments/tactical-timed-game.ts',
  'experiments/tactical-timed-run.ts',
  'experiments/summarize-tactical-timed.py',
);
const hashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
type Decision = {
  index: number;
  round: number;
  phase: string;
  samples: number;
  changed: boolean;
  nextSearches: number;
  elapsedMs: number;
  action: Action;
  reference: Action;
};
type Game = {
  seat: number | null;
  candidate: boolean;
  cash: number[];
  wins: number[];
  actions: Action[];
  decisions: Decision[];
  elapsedMs: number;
};
type Data = {
  version: string;
  pool: string;
  seed: number;
  count: number;
  hashes: Record<string, string>;
  options: Record<string, number>;
  runtime: string;
  status: string;
  games: Game[];
};
let data: Data = {
  version: TACTICAL_VERSION,
  pool,
  seed,
  count,
  hashes,
  options: {
    auctionSamples: 24,
    rootSamples: 8,
    replySamples: 2,
    depth: 2,
    budgetMs: 1000,
    auctionBudgetMs: 180,
  },
  runtime: process.version,
  status: 'running',
  games: [],
};
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, 'utf8')) as Data;
  if (
    JSON.stringify(previous.hashes) !== JSON.stringify(hashes) ||
    previous.seed !== seed ||
    previous.count !== count ||
    previous.pool !== pool
  )
    throw new Error(`Cannot resume different source/configuration: ${output}`);
  data = previous;
}
function save() {
  writeFileSync(`${output}.tmp`, JSON.stringify(data));
  renameSync(`${output}.tmp`, output);
}
const cache = new Map<string, Action>();
// Restore the frozen first expert action for every completed trajectory.
// Candidate offers are deliberately excluded: they are not expert actions.
for (const game of data.games) {
  let state = createGame(count, seed, seed % count);
  for (const [index, action] of game.actions.entries()) {
    if (
      state.phase !== 'roundEnd' &&
      !game.decisions.some((d) => d.index === index)
    ) {
      const key = JSON.stringify(observe(state, actor(state)!));
      const prior = cache.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(action))
        throw new Error('Conflicting frozen expert actions');
      cache.set(key, action);
    }
    state = applyAction(state, action);
  }
}
function expert(o: Observation): Action {
  const key = JSON.stringify(o);
  const hit = cache.get(key);
  if (hit) return hit;
  let action: Action;
  if (o.phase === 'offer' || o.phase === 'pair')
    action = chooseImprovedAction(o);
  else {
    const r = searchAuction(o, { samples: 24, budgetMs: 180 });
    action = r.action;
  }
  cache.set(key, action);
  return action;
}
function run(seat: number | null, candidate: boolean) {
  if (data.games.some((g) => g.seat === seat && g.candidate === candidate))
    return;
  const started = performance.now();
  let state = createGame(count, seed, seed % count);
  const actions: Action[] = [],
    decisions: Decision[] = [];
  while (state.phase !== 'finished') {
    if (actions.length > 5000) throw new Error('Game did not terminate');
    let action: Action;
    if (state.phase === 'roundEnd') action = { type: 'next' };
    else {
      const id = actor(state)!;
      const o = observe(state, id);
      if (
        candidate &&
        id === seat &&
        (o.phase === 'offer' || o.phase === 'pair')
      ) {
        const r = searchTacticalOffer(o, {
          samples: 8,
          replySamples: 2,
          depth: 2,
          budgetMs: 1000,
        });
        action = r.action;
        decisions.push({
          index: actions.length,
          round: o.round,
          phase: o.phase,
          samples: r.completedSamples,
          changed: JSON.stringify(action) !== JSON.stringify(r.reference),
          nextSearches: r.nextDecisionSearches,
          elapsedMs: r.elapsedMs,
          action,
          reference: r.reference,
        });
      } else action = expert(o);
    }
    actions.push(action);
    state = applyAction(state, action);
    assertState(state);
  }
  const cash = state.players.map((p) => p.cash),
    high = Math.max(...cash),
    ties = cash.filter((v) => v === high).length;
  const game = {
    seat,
    candidate,
    cash,
    wins: cash.map((v) => (v === high ? 1 / ties : 0)),
    actions,
    decisions,
    elapsedMs: performance.now() - started,
  };
  if (candidate) {
    const base = data.games.find((g) => !g.candidate && g.seat === null)!;
    let index = 0;
    while (
      index < Math.min(actions.length, base.actions.length) &&
      JSON.stringify(actions[index]) === JSON.stringify(base.actions[index])
    )
      index++;
    if (index < Math.max(actions.length, base.actions.length)) {
      const first = decisions.find((d) => d.index === index);
      if (!first || !first.changed)
        throw new Error(
          `Uncontrolled first divergence ${seed}/${count}/${seat}/${index}`,
        );
    }
  }
  data.games.push(game);
  save();
  console.log(
    JSON.stringify({
      pool,
      seed,
      count,
      seat,
      candidate,
      finishedGames: data.games.length,
    }),
  );
}
run(null, false);
for (let seat = 0; seat < count; seat++) {
  run(seat, true);
}
data.status = 'complete';
save();
