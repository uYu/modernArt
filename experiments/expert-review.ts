import { actor, applyAction, createGame, observe } from '../src/game/engine.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import { chooseAction } from '../src/game/ai.ts';
const seeds = Number(process.argv[2] ?? 10);
for (const count of [3, 4, 5]) {
  const wins = [0, 0];
  for (let seed = 192001; seed < 192001 + seeds; seed++)
    for (let seat = 0; seat < count; seat++)
      for (let variant = 0; variant < 2; variant++) {
        let game = createGame(count, seed, seed % count),
          steps = 0;
        while (game.phase !== 'finished') {
          if (++steps > 5000) throw new Error('nontermination');
          const id = actor(game)!;
          game = applyAction(
            game,
            game.phase === 'roundEnd'
              ? { type: 'next' }
              : id === seat && variant === 0
                ? chooseAction(observe(game, id))
                : chooseLevelAction(
                    observe(game, id),
                    id === seat ? 'expert' : 'hard',
                  ),
          );
        }
        const max = Math.max(...game.players.map((p) => p.cash));
        if (game.players[seat].cash === max)
          wins[variant] +=
            1 / game.players.filter((p) => p.cash === max).length;
      }
  console.log(
    JSON.stringify({
      count,
      gamesPerVariant: seeds * count,
      old: wins[0] / (seeds * count),
      updated: wins[1] / (seeds * count),
    }),
  );
}
