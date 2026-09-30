import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import {
  searchAuction,
  UNIVERSAL_AUCTION_VERSION,
} from '../src/game/ai-universal.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import type { Action, Observation } from '../src/game/types.ts';
const start = Number(process.argv[2] ?? 610001);
const seeds = Number(process.argv[3] ?? 6);
const opponents = process.argv[4] ?? 'expert';
const output = process.argv[5] ?? '/tmp/universal-benchmark.json';
if (
  !Number.isSafeInteger(start) ||
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  !['expert', 'mixed', 'hard'].includes(opponents)
)
  throw new Error('Invalid benchmark configuration');
const files = [
  'ai-universal',
  'ai-improved',
  'ai-planning',
  'ai-search',
  'ai',
  'ai-legacy',
  'ai-levels',
  'engine',
  'data',
  'ledger',
].map((name) => `src/game/${name}.ts`);
const hashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
const rows: {
  count: number;
  seed: number;
  seat: number;
  candidateWin: number;
  baselineWin: number;
  candidateCash: number[];
  baselineCash: number[];
}[] = [];
const timing: number[] = [];
const phaseStats: Record<
  string,
  { decisions: number; changed: number; simulations: number }
> = {};
function rival(o: Observation, focal: number): Action {
  const base =
    opponents === 'hard'
      ? chooseLevelAction(o, 'hard')
      : chooseImprovedAction(o);
  if (opponents !== 'mixed') return base;
  const factor = (o.self.id - focal + o.players.length) % 2 ? 0.8 : 1.2;
  if (base.type === 'price' || (base.type === 'bid' && base.amount !== null)) {
    const amount = Math.min(o.self.cash, Math.floor(base.amount! * factor));
    return {
      ...base,
      amount:
        base.type === 'bid' &&
        o.auction!.type !== 'sealed' &&
        amount <= o.auction!.high
          ? null
          : amount,
    } as Action;
  }
  if (base.type === 'buy')
    return {
      ...base,
      accept:
        base.accept && (factor > 1 || o.auction!.price! <= o.self.cash * 0.35),
    };
  return base;
}
function run(count: number, seed: number, seat: number, candidate: boolean) {
  let s = createGame(count, seed, seed % count);
  let steps = 0;
  while (s.phase !== 'finished') {
    if (++steps > 5000) throw new Error('nontermination');
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const id = actor(s)!;
    const o = observe(s, id);
    const started = performance.now();
    let action: Action;
    if (id === seat && candidate && o.phase !== 'offer' && o.phase !== 'pair') {
      const result = searchAuction(o);
      action = result.action;
      const key = `${o.phase}/${o.auction!.type}`;
      const row = (phaseStats[key] ??= {
        decisions: 0,
        changed: 0,
        simulations: 0,
      });
      row.decisions++;
      row.changed +=
        JSON.stringify(result.action) === JSON.stringify(result.reference)
          ? 0
          : 1;
      row.simulations += result.completedSamples;
    } else action = id === seat ? chooseImprovedAction(o) : rival(o, seat);
    if (candidate && id === seat) timing.push(performance.now() - started);
    s = applyAction(s, action);
  }
  assertState(s);
  return s.players.map((p) => p.cash);
}
function win(cash: number[], seat: number) {
  const high = Math.max(...cash);
  return cash[seat] === high ? 1 / cash.filter((x) => x === high).length : 0;
}
for (const count of [3, 4, 5]) {
  for (let seed = start; seed < start + seeds; seed++) {
    const common =
      opponents === 'expert' ? run(count, seed, 0, false) : undefined;
    for (let seat = 0; seat < count; seat++) {
      const candidateCash = run(count, seed, seat, true),
        baselineCash = common ?? run(count, seed, seat, false);
      rows.push({
        count,
        seed,
        seat,
        candidateCash,
        baselineCash,
        candidateWin: win(candidateCash, seat),
        baselineWin: win(baselineCash, seat),
      });
    }
    writeFileSync(
      output,
      JSON.stringify(
        {
          version: UNIVERSAL_AUCTION_VERSION,
          start,
          seeds,
          opponents,
          hashes,
          rows,
          phaseStats,
          runtime: process.version,
          timing: {
            decisions: timing.length,
            totalMs: timing.reduce((a, b) => a + b, 0),
            maxMs: timing.reduce((a, b) => Math.max(a, b), 0),
          },
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ count, completedSeed: seed, games: rows.length }),
    );
  }
  const group = rows.filter((r) => r.count === count);
  console.log(
    JSON.stringify({
      count,
      games: group.length,
      candidate: group.reduce((s, r) => s + r.candidateWin, 0) / group.length,
      baseline: group.reduce((s, r) => s + r.baselineWin, 0) / group.length,
    }),
  );
}
