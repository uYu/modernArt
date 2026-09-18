import { ranking } from './engine.ts';
import type { Action, Card, Observation } from './types.ts';
function values(o: Observation, counts = o.counts) {
  const ranks = ranking(counts);
  return counts.map((_, a) =>
    ranks.includes(a)
      ? 30 - ranks.indexOf(a) * 10 + o.awards.reduce((sum, r) => sum + r[a], 0)
      : 0,
  );
}
export function estimate(o: Observation, artist: number) {
  const now = values(o)[artist],
    count = o.counts[artist],
    own = o.self.hand.filter((c) => c.artist === artist).length;
  const past = o.awards.reduce((sum, r) => sum + r[artist], 0);
  const certainty = Math.max(0.25, Math.min(0.95, count / 5 + own * 0.09));
  return (
    now * certainty +
    (past + 15) * (1 - certainty) * Math.min(1, (count + own) / 4)
  );
}
function offerScore(o: Observation, card: Card) {
  const counts = [...o.counts];
  counts[card.artist]++;
  const prices = values(o, counts);
  if (counts[card.artist] >= 5) {
    const revenues = o.players.map((p) =>
      p.collection.reduce((sum, c) => sum + prices[c.artist], 0),
    );
    return (
      revenues[o.self.id] -
      Math.max(...revenues.filter((_, i) => i !== o.self.id)) * 0.65
    );
  }
  const before = values(o),
    ownGain = o.self.collection.reduce(
      (sum, c) => sum + prices[c.artist] - before[c.artist],
      0,
    );
  const othersGain = o.players
    .filter((p) => p.id !== o.self.id)
    .reduce(
      (sum, p) =>
        sum +
        p.collection.reduce(
          (v, c) => v + prices[c.artist] - before[c.artist],
          0,
        ),
      0,
    );
  const pair =
    card.type === 'double' &&
    o.self.hand.some((c) => c.artist === card.artist && c.type !== 'double');
  return (
    estimate({ ...o, counts }, card.artist) * 0.55 +
    ownGain * 0.45 -
    othersGain * 0.12 +
    (pair ? 12 : 0) +
    (card.type === 'double' && !pair ? -8 : 0)
  );
}
export function bidLimit(o: Observation): number {
  const value =
    estimate(o, o.auction!.cards[0].artist) * o.auction!.cards.length;
  return Math.max(
    0,
    Math.min(o.self.cash, Math.floor(value * (0.76 + (o.self.id % 3) * 0.055))),
  );
}

export function chooseAction(o: Observation): Action {
  const player = o.self.id;
  if (o.phase === 'offer') {
    const card = [...o.self.hand].sort(
      (a, b) => offerScore(o, b) - offerScore(o, a) || a.id.localeCompare(b.id),
    )[0];
    if (!card) throw new Error('AI 没有可出的牌');
    return { type: 'offer', player, card: card.id };
  }
  const a = o.auction;
  if (!a) throw new Error('缺少拍卖');
  if (o.phase === 'pair') {
    const cards = o.self.hand.filter(
      (c) => c.artist === a.cards[0].artist && c.type !== 'double',
    );
    const card = cards.sort((x, y) => offerScore(o, y) - offerScore(o, x))[0];
    return { type: 'pair', player, card: card?.id ?? null };
  }
  const value = estimate(o, a.cards[0].artist) * a.cards.length;
  const limit = bidLimit(o);
  if (o.phase === 'price')
    return {
      type: 'price',
      player,
      amount: Math.max(0, Math.min(o.self.cash, Math.round(value * 0.65))),
    };
  if (a.type === 'fixed')
    return { type: 'buy', player, accept: a.price! <= limit };
  if (a.type === 'sealed')
    return {
      type: 'bid',
      player,
      amount: Math.min(limit, Math.round(value * (0.43 + player * 0.035))),
    };
  if (a.high >= limit) return { type: 'bid', player, amount: null };
  const amount =
    a.type === 'once'
      ? Math.max(a.high + 1, Math.round(limit * 0.76))
      : Math.min(limit, a.high + Math.max(1, Math.floor(value / 12)));
  return { type: 'bid', player, amount };
}
