import { writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  createGame,
  observe,
  assertState,
} from '../src/game/engine.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import type { GameLevel } from '../src/game/preferences.ts';
const start = Number(process.argv[2] ?? 131001),
  seeds = Number(process.argv[3] ?? 20);
const output = process.argv[4] ?? 'experiments/difficulty-balance-pilot.json';
const rows = [];
for (const [lower, higher] of [
  ['beginner', 'medium'],
  ['medium', 'hard'],
  ['hard', 'expert'],
] as [GameLevel, GameLevel][])
  for (const count of [3, 4, 5]) {
    const wins = [];
    for (let seed = start; seed < start + seeds; seed++)
      for (let seat = 0; seat < count; seat++) {
        let s = createGame(count, seed, seed % count),
          steps = 0;
        while (s.phase !== 'finished') {
          if (++steps > 5000) throw new Error('nontermination');
          const id = actor(s)!;
          s = applyAction(
            s,
            s.phase === 'roundEnd'
              ? { type: 'next' }
              : chooseLevelAction(observe(s, id), id === seat ? higher : lower),
          );
        }
        assertState(s);
        const cash = s.players.map((p) => p.cash),
          max = Math.max(...cash);
        const win =
          cash[seat] === max ? 1 / cash.filter((v) => v === max).length : 0;
        wins.push(win);
        rows.push({ lower, higher, count, seed, seat, win, cash });
      }
    console.log(
      JSON.stringify({
        lower,
        higher,
        count,
        n: wins.length,
        win: wins.reduce((a, b) => a + b, 0) / wins.length,
        chance: 1 / count,
      }),
    );
    writeFileSync(output, JSON.stringify({ start, seeds, rows }, null, 2));
  }
