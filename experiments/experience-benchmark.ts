import { writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  createGame,
  observe,
  assertState,
} from '../src/game/engine.ts';
import { chooseAction as v31 } from '../src/game/ai.ts';
import { chooseAction as v3 } from './ai-before-jumps.ts';
import { chooseAction as legacy } from '../src/game/ai-legacy.ts';
import { chooseConfiguredAction } from '../src/game/ai-configured.ts';
import type { Observation, Action } from '../src/game/types.ts';
import type { AIConfig } from '../src/game/preferences.ts';
const start = Number(process.argv[2] ?? 91001),
  seeds = Number(process.argv[3] ?? 12),
  output = process.argv[4] ?? 'experiments/experience-pilot.json';
const mode = process.argv[5] ?? 'adaptive';
const rows: {
  count: number;
  seed: number;
  seat: number;
  opponents: string;
  win: number;
  baselineWin: number;
  steps: number;
  baselineSteps: number;
}[] = [];
function config(count: number, seed: number): AIConfig {
  const styles = ['balanced', 'cautious', 'bold', 'control'] as const;
  return {
    difficulty: 'standard',
    personalities: Array.from(
      { length: count },
      (_, i) => styles[(seed + i) % 4],
    ),
  };
}
function rival(o: Observation, seat: number, mixed: boolean): Action {
  const a = legacy(o);
  if (!mixed) return a;
  const factor =
    ((o.self.id - seat + o.players.length) % o.players.length) % 2 ? 0.8 : 1.2;
  if (a.type === 'bid' && a.amount !== null) {
    const amount = Math.min(o.self.cash, Math.floor(a.amount * factor));
    return {
      ...a,
      amount:
        o.auction!.type === 'sealed' || amount > o.auction!.high
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
function run(
  count: number,
  seed: number,
  seat: number,
  mixed: boolean,
  candidate: boolean,
) {
  let s = createGame(count, seed, seed % count),
    steps = 0;
  const c = config(count, seed);
  while (s.phase !== 'finished') {
    if (++steps > 6000) throw new Error('nontermination');
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    const id = actor(s)!,
      o = observe(s, id);
    const policy =
      mode === 'jumps'
        ? candidate
          ? v31
          : v3
        : mode === 'standard'
          ? candidate
            ? (x: Observation) => chooseConfiguredAction(x, c)
            : v31
          : (x: Observation) =>
              chooseConfiguredAction(x, {
                ...c,
                difficulty: candidate ? 'adaptive' : 'standard',
              });
    s = applyAction(s, id === seat ? policy(o) : rival(o, seat, mixed));
  }
  assertState(s);
  const cash = s.players.map((p) => p.cash),
    max = Math.max(...cash);
  return {
    win: cash[seat] === max ? 1 / cash.filter((n) => n === max).length : 0,
    steps,
  };
}
for (const mixed of [false, true])
  for (const count of [3, 4, 5]) {
    for (let seed = start; seed < start + seeds; seed++)
      for (let seat = 0; seat < count; seat++) {
        const a = run(count, seed, seat, mixed, true),
          b = run(count, seed, seat, mixed, false);
        rows.push({
          count,
          seed,
          seat,
          opponents: mixed ? 'mixed' : 'legacy',
          win: a.win,
          baselineWin: b.win,
          steps: a.steps,
          baselineSteps: b.steps,
        });
      }
    const group = rows.filter(
      (r) => r.count === count && r.opponents === (mixed ? 'mixed' : 'legacy'),
    );
    console.log(
      JSON.stringify({
        count,
        opponents: mixed ? 'mixed' : 'legacy',
        n: group.length,
        candidate: group.reduce((v, r) => v + r.win, 0) / group.length,
        baseline: group.reduce((v, r) => v + r.baselineWin, 0) / group.length,
      }),
    );
    writeFileSync(
      output,
      JSON.stringify({ start, seeds, mode, rows }, null, 2),
    );
  }
