import { applyAction, createGame } from './engine.ts';
import type { GameState } from './types.ts';

export function seasonFinance(game: GameState, round: number, player: number) {
  const trades = game.transactions.filter((t) => t.round === round);
  const sales = trades.reduce(
    (n, t) => n + (t.seller === player && t.buyer !== player ? t.amount : 0),
    0,
  );
  const purchases = trades.reduce(
    (n, t) => n + (t.buyer === player ? t.amount : 0),
    0,
  );
  const settlement =
    game.history.find((r) => r.round === round)?.income[player] ?? 0;
  return { sales, purchases, settlement, net: sales - purchases + settlement };
}

// Rebuild on demand, keeping memory bounded; never mutate the live game.
export function replayAt(game: GameState, step: number) {
  let state = createGame(game.players.length, game.seed, game.first);
  for (const action of game.actions.slice(
    0,
    Math.max(0, Math.min(step, game.actions.length)),
  ))
    state = applyAction(state, action);
  return state;
}

export function replayMilestones(game: GameState) {
  return game.actions
    .flatMap((action, i) =>
      action.type === 'offer' || action.type === 'next' ? [i] : [],
    )
    .concat(game.actions.length);
}

export function settlementMoments(game: GameState) {
  let state = createGame(game.players.length, game.seed, game.first);
  const moments: {
    round: number;
    step: number;
    player: number | null;
    before: number;
    after: number;
  }[] = [];
  const rank = (s: GameState) =>
    1 + s.players.filter((p) => p.cash > s.players[0].cash).length;
  game.actions.forEach((action, index) => {
    const next = applyAction(state, action);
    if (next.history.length > state.history.length)
      moments.push({
        round: state.round,
        step: index + 1,
        player: 'player' in action ? action.player : null,
        before: rank(state),
        after: rank(next),
      });
    state = next;
  });
  return moments;
}
