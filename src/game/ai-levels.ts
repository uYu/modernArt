import { chooseAction as experienced } from './ai.ts';
import { chooseAction as local, estimate } from './ai-legacy.ts';
import { ranking } from './engine.ts';
import type { Action, Observation, Card } from './types.ts';
import type { GameLevel } from './preferences.ts';

// Reproducible judgement error, constant throughout the same auction.
// Only permitted public state and the player's own information enter this hash.
function judgement(o: Observation, key: string) {
  let hash = o.round * 101 + o.self.id * 13;
  for (const c of `${key}:${o.counts.join(',')}`)
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return (hash % 1001) / 1000;
}
function beginnerOffer(o: Observation, card: Card) {
  const counts = [...o.counts];
  counts[card.artist]++;
  const rank = ranking(counts);
  const values = counts.map((_, a) =>
    rank.includes(a)
      ? o.awards.reduce((n, r) => n + r[a], 0) + 30 - rank.indexOf(a) * 10
      : 0,
  );
  // Notices their own collection, but not rivals' wealth or future control of supply.
  if (counts[card.artist] >= 5)
    return o.self.collection.reduce((n, c) => n + values[c.artist], 0) * 0.35;
  const sale = estimate({ ...o, counts }, card.artist);
  const own = o.self.collection.filter((c) => c.artist === card.artist).length;
  const pair =
    card.type === 'double' &&
    o.self.hand.some((c) => c.artist === card.artist && c.type !== 'double');
  return (
    sale * 0.55 +
    own * 3 +
    (pair ? 5 : card.type === 'double' ? -6 : 0) +
    (judgement(o, card.id) - 0.5) * 20
  );
}
export function chooseLevelAction(o: Observation, level: GameLevel): Action {
  if (level === 'expert') return experienced(o);
  if (level === 'hard') {
    // Limited planning: search offering/pairing near the end of a season or game.
    const tactical = o.round === 4 || Math.max(...o.counts) >= 3;
    return (o.phase === 'offer' || o.phase === 'pair') && !tactical
      ? local(o)
      : experienced(o);
  }
  if (level === 'medium')
    return o.phase === 'offer' || o.phase === 'pair'
      ? local(o)
      : experienced(o);
  const player = o.self.id;
  if (o.phase === 'offer' || o.phase === 'pair') {
    const cards = o.self.hand.filter(
      (c) =>
        o.phase === 'offer' ||
        (c.artist === o.auction!.cards[0].artist && c.type !== 'double'),
    );
    cards.sort(
      (a, b) =>
        beginnerOffer(o, b) - beginnerOffer(o, a) || a.id.localeCompare(b.id),
    );
    if (o.phase === 'pair')
      return { type: 'pair', player, card: cards[0]?.id ?? null };
    if (!cards[0]) throw new Error('AI 没有可出的牌');
    return { type: 'offer', player, card: cards[0].id };
  }
  const a = o.auction!;
  const error = 0.7 + judgement(o, a.cards.map((c) => c.id).join('/')) * 0.6;
  const value = estimate(o, a.cards[0].artist) * a.cards.length * error;
  const limit = Math.max(0, Math.min(o.self.cash, Math.floor(value * 0.82)));
  if (o.phase === 'price')
    return {
      type: 'price',
      player,
      amount: Math.min(o.self.cash, Math.max(0, Math.round(value * 0.68))),
    };
  if (a.type === 'fixed')
    return { type: 'buy', player, accept: a.price! <= limit };
  if (a.type === 'sealed')
    return {
      type: 'bid',
      player,
      amount: Math.min(limit, Math.round(value * 0.52)),
    };
  return {
    type: 'bid',
    player,
    amount:
      a.high >= limit
        ? null
        : a.type === 'once'
          ? Math.min(limit, Math.max(a.high + 1, Math.round(limit * 0.76)))
          : Math.min(
              limit,
              a.high +
                Math.max(1, Math.min(8, Math.ceil((limit - a.high) / 4))),
            ),
  };
}
