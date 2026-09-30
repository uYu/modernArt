import { chooseAction as baseline } from './ai-expert-baseline.ts';
import { estimate, bidLimit } from './ai-legacy.ts';
import { publicCash } from './ai-search.ts';
import { sampleWorld, observationSeed } from './ai-planning.ts';
import { observe } from './engine.ts';
import { random } from './data.ts';
import type { Action, Observation } from './types.ts';

export type UpgradeVariant = 'auction' | 'sealed' | 'fixed';
export const UPGRADE_VERSION = 'expert-v2-auction';
const SAMPLES = 32;

/** Local auction policy improvement. Only observed inputs and sampled private
 * hands inform opponents' reservation prices. No real hidden bids are used. */
export function chooseImprovedAction(
  o: Observation,
  variant: UpgradeVariant = 'auction',
): Action {
  if (o.phase === 'offer' || o.phase === 'pair') return baseline(o);
  const a = o.auction!;
  const enabled =
    (a.type === 'sealed' && variant !== 'fixed') ||
    (o.phase === 'price' && variant !== 'sealed');
  if (!enabled) return baseline(o);
  const me = o.self.id;
  const cash = publicCash(o);
  const values = o.counts.map((_, artist) => estimate(o, artist));
  const lot = values[a.cards[0].artist] * a.cards.length;
  const wealth = cash.map(
    (money, id) =>
      money +
      o.players[id].collection.reduce((sum, c) => sum + values[c.artist], 0),
  );
  const weight = o.round === 4 ? 0.8 : 0.35;
  function utility(winner: number, price: number) {
    const w = [...wealth];
    w[winner] += lot - price;
    if (winner !== a.seller) w[a.seller] += price;
    return w[me] - weight * Math.max(...w.filter((_, id) => id !== me));
  }
  const seed = observationSeed(o);
  const rng = random(seed ^ 0x313);
  const scenarios: number[][] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const world = sampleWorld(o, (seed + Math.imul(k + 1, 2654435761)) >>> 0);
    scenarios.push(
      o.players.map((p) => {
        const view = observe(world, p.id);
        const v = estimate(view, a.cards[0].artist) * a.cards.length;
        const limit =
          a.type === 'sealed'
            ? Math.min(bidLimit(view), Math.round(v * (0.43 + p.id * 0.035)))
            : bidLimit(view);
        // Explicit behavior uncertainty, rather than assuming sampled hands imply
        // exact knowledge of every rival's implementation.
        return Math.max(
          0,
          Math.min(cash[p.id], Math.round(limit * (0.8 + rng() * 0.4))),
        );
      }),
    );
  }
  const max = Math.min(o.self.cash, Math.ceil(lot));
  let best = 0;
  let bestScore = -Infinity;
  for (let price = 0; price <= max; price++) {
    let score = 0;
    for (const limits of scenarios) {
      const { winner, paid } = modelAuctionOutcome(
        a.type === 'fixed' ? 'fixed' : 'sealed',
        a.seller,
        me,
        price,
        limits,
      );
      score += utility(winner, paid);
    }
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = price;
    }
  }
  return {
    type: o.phase === 'price' ? 'price' : 'bid',
    player: me,
    amount: best,
  };
}

/** Resolve the actual sequential fixed-price acceptance and seller-first sealed
 * tie rule. Limits contain one jointly sampled opponent profile, not independent
 * marginal win probabilities. */
export function modelAuctionOutcome(
  type: 'fixed' | 'sealed',
  seller: number,
  me: number,
  price: number,
  limits: number[],
) {
  let winner = seller;
  let paid = price;
  if (type === 'fixed') {
    for (let offset = 1; offset < limits.length; offset++) {
      const id = (seller + offset) % limits.length;
      if (limits[id] >= price) {
        winner = id;
        break;
      }
    }
  } else {
    paid = seller === me ? price : limits[seller];
    for (let offset = 1; offset < limits.length; offset++) {
      const id = (seller + offset) % limits.length;
      const bid = id === me ? price : limits[id];
      if (bid > paid) {
        winner = id;
        paid = bid;
      }
    }
  }
  return { winner, paid };
}
