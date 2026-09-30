import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseAction as baseline } from '../src/game/ai-expert-baseline.ts';
import {
  chooseImprovedAction,
  UPGRADE_VERSION,
} from '../src/game/ai-improved.ts';
import type { UpgradeVariant } from '../src/game/ai-improved.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import type { Action, Observation } from '../src/game/types.ts';
const start = Number(process.argv[2] ?? 410001);
const seeds = Number(process.argv[3] ?? 10);
const variant = (process.argv[4] ?? 'auction') as UpgradeVariant;
const opponents = process.argv[5] ?? 'expert';
const output = process.argv[6] ?? `/tmp/upgrade-${variant}-${opponents}.json`;
const files = [
  'ai-improved',
  'ai-expert-baseline',
  'ai-search',
  'ai',
  'ai-legacy',
  'ai-planning',
  'engine',
  'data',
  'ledger',
].map((f) => `src/game/${f}.ts`);
const hashes = Object.fromEntries(
  files.map((f) => [
    f,
    createHash('sha256').update(readFileSync(f)).digest('hex'),
  ]),
);
const rows: {
  count: number;
  seed: number;
  seat: number;
  win: number;
  baselineWin: number;
  cash: number[];
  baselineCash: number[];
}[] = [];
const times: number[] = [];
function rival(o: Observation, focal: number): Action {
  const base =
    opponents === 'hard' ? chooseLevelAction(o, 'hard') : baseline(o);
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
function run(count: number, seed: number, seat: number, upgraded: boolean) {
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
    const t = performance.now();
    const a =
      id === seat
        ? upgraded
          ? chooseImprovedAction(o, variant)
          : baseline(o)
        : rival(o, seat);
    if (upgraded && id === seat) times.push(performance.now() - t);
    s = applyAction(s, a);
  }
  assertState(s);
  return s.players.map((p) => p.cash);
}
function win(cash: number[], seat: number) {
  const max = Math.max(...cash);
  return cash[seat] === max ? 1 / cash.filter((x) => x === max).length : 0;
}
for (const count of [3, 4, 5]) {
  for (let seed = start; seed < start + seeds; seed++) {
    const common =
      opponents === 'expert' ? run(count, seed, 0, false) : undefined;
    for (let seat = 0; seat < count; seat++) {
      const cash = run(count, seed, seat, true),
        baselineCash = common ?? run(count, seed, seat, false);
      rows.push({
        count,
        seed,
        seat,
        cash,
        baselineCash,
        win: win(cash, seat),
        baselineWin: win(baselineCash, seat),
      });
    }
    writeFileSync(
      output,
      JSON.stringify(
        {
          version: UPGRADE_VERSION,
          start,
          seeds,
          variant,
          opponents,
          hashes,
          rows,
          timing: {
            decisions: times.length,
            totalMs: times.reduce((a, b) => a + b, 0),
            maxMs: times.reduce((max, x) => Math.max(max, x), 0),
          },
        },
        null,
        2,
      ),
    );
  }
  const r = rows.filter((r) => r.count === count);
  console.log(
    JSON.stringify({
      count,
      n: r.length,
      variant,
      opponents,
      win: r.reduce((a, b) => a + b.win, 0) / r.length,
      baseline: r.reduce((a, b) => a + b.baselineWin, 0) / r.length,
    }),
  );
}
