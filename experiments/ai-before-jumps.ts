import { chooseAction as search, publicCash } from '../src/game/ai-search.ts';
import { chooseAction as legacy } from '../src/game/ai-legacy.ts';
import { ranking } from '../src/game/engine.ts';
import type { Action, Observation } from '../src/game/types.ts';
export { publicCash } from '../src/game/ai-search.ts';
export const AI_VERSION = 'market-v3';

// Keep the tested local bidding baseline: full model-based bidding proved brittle
// against mixed opponents. Use sampling where it helped most: offering/pairing.
export function chooseAction(o: Observation): Action {
  if (o.phase === 'offer' || o.phase === 'pair') return search(o);
  const action = legacy(o),
    a = o.auction!;
  if (action.type !== 'bid' || action.amount === null || a.type === 'sealed')
    return action;
  const amount = a.type === 'open' ? a.high + 1 : action.amount;
  if (a.seller !== o.self.id || a.bidder === null) return { ...action, amount };

  // Selling also has a payoff. Compare full cash/portfolio vectors, not just
  // whether the lot is worth more than the self-purchase price.
  const ranks = ranking(o.counts);
  const values = o.counts.map((count, artist) => {
    const past = o.awards.reduce((sum, r) => sum + r[artist], 0);
    const now = ranks.includes(artist)
      ? past + 30 - ranks.indexOf(artist) * 10
      : 0;
    const own = o.self.hand.filter((c) => c.artist === artist).length;
    const confidence = Math.max(0.25, Math.min(0.95, count / 5 + own * 0.09));
    return (
      now * confidence +
      (past + 15) * (1 - confidence) * Math.min(1, (count + own) / 4)
    );
  });
  const wealth = publicCash(o).map(
    (cash, i) =>
      cash +
      o.players[i].collection.reduce((sum, c) => sum + values[c.artist], 0),
  );
  const value = values[a.cards[0].artist] * a.cards.length;
  const bought = [...wealth],
    sold = [...wealth];
  bought[o.self.id] += value - amount;
  sold[o.self.id] += a.high;
  sold[a.bidder] += value - a.high;
  function utility(w: number[]) {
    const rivals = w.filter((_, i) => i !== o.self.id),
      max = Math.max(...rivals);
    const temperature = o.round === 4 ? 18 : 45;
    const threat =
      max +
      temperature *
        Math.log(
          rivals.reduce(
            (sum, v) => sum + Math.exp((v - max) / temperature),
            0,
          ) / rivals.length,
        );
    return w[o.self.id] - (o.round === 4 ? 0.8 : 0.45) * threat;
  }
  return { ...action, amount: utility(bought) > utility(sold) ? amount : null };
}
