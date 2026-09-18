import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseAction, AI_VERSION } from '../src/game/ai.ts';
import { chooseAction as searchV2 } from '../src/game/ai-search.ts';
import { chooseAction as legacy } from '../src/game/ai-legacy.ts';
import type { Observation, Action } from '../src/game/types.ts';
const start = Number(process.argv[2] ?? 20001),
  seeds = Number(process.argv[3] ?? 60);
const output = process.argv[4] ?? 'experiments/holdout.json';
const opponents = process.argv[5] ?? 'legacy';
const variant = process.argv[6] ?? 'full';
const model = process.argv[7] ?? 'v3';
const policy = model === 'v2' ? searchV2 : chooseAction;
if (
  !['legacy', 'mixed'].includes(opponents) ||
  !['full', 'bid-only', 'offer-only'].includes(variant) ||
  seeds < 1
)
  throw new Error('Invalid benchmark configuration');
const rows: {
  count: number;
  seed: number;
  seat: number;
  win: number;
  baselineWin: number;
  cash: number[];
  baselineCash: number[];
  steps: number;
}[] = [];
const times: number[] = [];
function rival(o: Observation, focal: number): Action {
  const a = legacy(o);
  if (opponents === 'legacy') return a;
  const factor =
    ((o.self.id - focal + o.players.length) % o.players.length) % 2 === 0
      ? 1.2
      : 0.8;
  if (a.type === 'bid' && a.amount !== null) {
    const amount = Math.min(o.self.cash, Math.floor(a.amount * factor));
    return {
      ...a,
      amount:
        o.auction!.type === 'sealed'
          ? amount
          : amount > o.auction!.high
            ? amount
            : null,
    };
  }
  if (a.type === 'price')
    return {
      ...a,
      amount: Math.min(o.self.cash, Math.floor(a.amount * factor)),
    };
  if (a.type === 'buy')
    return {
      ...a,
      accept:
        a.accept && (factor > 1 || o.auction!.price! <= o.self.cash * 0.35),
    };
  return a;
}
function run(count: number, seed: number, seat: number, modern: boolean) {
  let s = createGame(count, seed, seed % count),
    steps = 0;
  while (s.phase !== 'finished') {
    if (++steps > 5000) throw new Error('nontermination');
    if (s.phase === 'roundEnd') s = applyAction(s, { type: 'next' });
    else {
      const id = actor(s)!,
        o = observe(s, id),
        t = performance.now();
      const enabled =
        modern &&
        id === seat &&
        (variant === 'full' ||
          (variant === 'offer-only'
            ? ['offer', 'pair'].includes(o.phase)
            : !['offer', 'pair'].includes(o.phase)));
      const action =
        id === seat ? (enabled ? policy(o) : legacy(o)) : rival(o, seat);
      if (enabled) times.push(performance.now() - t);
      s = applyAction(s, action);
    }
  }
  assertState(s);
  return { cash: s.players.map((p) => p.cash), steps };
}
function win(cash: number[], seat: number) {
  const max = Math.max(...cash);
  return cash[seat] === max ? 1 / cash.filter((v) => v === max).length : 0;
}
for (const count of [3, 4, 5]) {
  for (let seed = start; seed < start + seeds; seed++) {
    const commonBaseline =
      opponents === 'legacy' ? run(count, seed, 0, false) : null;
    for (let seat = 0; seat < count; seat++) {
      const modern = run(count, seed, seat, true),
        baseline = commonBaseline ?? run(count, seed, seat, false);
      rows.push({
        count,
        seed,
        seat,
        win: win(modern.cash, seat),
        baselineWin: win(baseline.cash, seat),
        cash: modern.cash,
        baselineCash: baseline.cash,
        steps: modern.steps,
      });
    }
  }
  const group = rows.filter((r) => r.count === count);
  console.log(
    JSON.stringify({
      count,
      games: group.length,
      winRate: group.reduce((v, r) => v + r.win, 0) / group.length,
      baseline: group.reduce((v, r) => v + r.baselineWin, 0) / group.length,
    }),
  );
}
times.sort((a, b) => a - b);
const sourceHash = createHash('sha256')
  .update(
    readFileSync(
      new URL(
        model === 'v2' ? '../src/game/ai-search.ts' : '../src/game/ai.ts',
        import.meta.url,
      ),
    ),
  )
  .digest('hex');
writeFileSync(
  output,
  JSON.stringify(
    {
      version: model === 'v2' ? 'market-v2' : AI_VERSION,
      sourceFiles: Object.fromEntries(
        ['ai.ts', 'ai-search.ts', 'ai-legacy.ts', 'engine.ts', 'data.ts'].map(
          (file) => [
            file,
            createHash('sha256')
              .update(
                readFileSync(new URL('../src/game/' + file, import.meta.url)),
              )
              .digest('hex'),
          ],
        ),
      ),
      sourceHash,
      start,
      seeds,
      opponents,
      variant,
      timing: {
        n: times.length,
        p50: times[Math.floor(times.length * 0.5)],
        p95: times[Math.floor(times.length * 0.95)],
        max: times.at(-1),
      },
      rows,
    },
    null,
    2,
  ),
);
console.log(output);
