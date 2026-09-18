// Matched-auction comparison: same public auction and private hands for both policies.
import { writeFileSync } from 'node:fs';
import {
  createGame,
  applyAction,
  actor,
  observe,
  assertState,
} from '../src/game/engine.ts';
import { chooseAction as legacy } from '../src/game/ai-legacy.ts';
import { chooseAction as before } from './ai-before-jumps.ts';
import { chooseAction as after } from '../src/game/ai.ts';
import type { GameState } from '../src/game/types.ts';
function play(start: GameState, policy: typeof before) {
  let s = structuredClone(start),
    steps = 0,
    raises = 0;
  while (s.auction) {
    if (++steps > 2000) throw new Error('auction did not terminate');
    const action = policy(observe(s, actor(s)!));
    if (action.type === 'bid' && action.amount !== null) raises++;
    s = applyAction(s, action);
    assertState(s);
  }
  const tx = s.transactions.at(-1)!;
  return { steps, raises, price: tx.amount, buyer: tx.buyer };
}
const rows = [];
for (const count of [3, 4, 5])
  for (let seed = 9100; seed < 9110; seed++) {
    let s = createGame(count, seed);
    while (s.phase !== 'finished') {
      const prev = s;
      s = applyAction(
        s,
        s.phase === 'roundEnd'
          ? { type: 'next' }
          : legacy(observe(s, actor(s)!)),
      );
      if (
        s.auction?.type === 'open' &&
        s.phase === 'bid' &&
        prev.phase !== 'bid'
      ) {
        rows.push({
          count,
          seed,
          round: s.round,
          before: play(s, before),
          after: play(s, after),
        });
      }
    }
  }
const mean = (
  policy: 'before' | 'after',
  field: 'steps' | 'raises' | 'price',
) => rows.reduce((n, r) => n + r[policy][field], 0) / rows.length;
const summary = {
  auctions: rows.length,
  games: 30,
  before: {
    steps: mean('before', 'steps'),
    raises: mean('before', 'raises'),
    price: mean('before', 'price'),
  },
  after: {
    steps: mean('after', 'steps'),
    raises: mean('after', 'raises'),
    price: mean('after', 'price'),
  },
  changedBuyer: rows.filter((r) => r.before.buyer !== r.after.buyer).length,
};
writeFileSync(
  new URL('./jump-bids.json', import.meta.url),
  JSON.stringify({ summary, rows }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
