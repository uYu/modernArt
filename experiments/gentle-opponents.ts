import { writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  createGame,
  observe,
  assertState,
} from '../src/game/engine.ts';
import { chooseAction } from '../src/game/ai.ts';
import { chooseConfiguredAction } from '../src/game/ai-configured.ts';
import type { Personality } from '../src/game/preferences.ts';
const rows = [];
for (const style of ['classic', 'novice', 'relaxed'] as Personality[]) {
  for (const count of [3, 4, 5]) {
    const wins = [];
    for (let seed = 121001; seed < 121021; seed++)
      for (let seat = 0; seat < count; seat++) {
        let game = createGame(count, seed, seed % count),
          steps = 0;
        const config = {
          difficulty: 'standard' as const,
          personalities: Array<Personality>(count).fill(style),
        };
        while (game.phase !== 'finished') {
          if (++steps > 5000) throw new Error('nontermination');
          const id = actor(game);
          game = applyAction(
            game,
            game.phase === 'roundEnd'
              ? { type: 'next' }
              : id === seat
                ? chooseAction(observe(game, id!))
                : chooseConfiguredAction(observe(game, id!), config),
          );
        }
        assertState(game);
        const cash = game.players.map((p) => p.cash),
          max = Math.max(...cash);
        const win =
          cash[seat] === max ? 1 / cash.filter((v) => v === max).length : 0;
        wins.push(win);
        rows.push({ style, count, seed, seat, win, cash });
      }
    console.log(
      JSON.stringify({
        style,
        count,
        games: wins.length,
        referenceWinRate: wins.reduce((a, b) => a + b, 0) / wins.length,
      }),
    );
  }
}
writeFileSync(
  'experiments/gentle-opponents.json',
  JSON.stringify(
    { reference: 'market-v3.1', start: 121001, seeds: 20, rows },
    null,
    2,
  ),
);
