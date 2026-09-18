import { chooseLevelAction } from './ai-levels.ts';
import { chooseAction as baseline } from './ai.ts';
import { chooseAction as legacy, estimate } from './ai-legacy.ts';
import { publicCash } from './ai-search.ts';
import type { Action, Observation } from './types.ts';
import type { AIConfig, Personality } from './preferences.ts';

const risk: Record<Personality, number> = {
  novice: 0.45,
  relaxed: 0.25,
  classic: 0.82,
  balanced: 0.82,
  cautious: 0.7,
  bold: 0.93,
  control: 0.86,
};

// Shrink a small public sample toward a prior. No losing sealed bids or hidden hands.
export function willingness(o: Observation, id: number, value: number): number {
  const artist = o.auction!.cards[0].artist;
  const trades = o.transactions
    .filter(
      (t) => t.buyer === id && t.seller !== id && t.cards[0].artist === artist,
    )
    .slice(-6);
  const paid = trades.reduce((sum, t) => sum + t.amount / t.cards.length, 0);
  const prior = (value / o.auction!.cards.length) * 0.75;
  return ((paid + prior * 4) / (trades.length + 4)) * o.auction!.cards.length;
}

// Deliberately limited opponents: no sampled offering, opponent model or end-season search.
function chooseGentleAction(o: Observation, relaxed: boolean): Action {
  const player = o.self.id;
  if (o.phase === 'offer' || o.phase === 'pair') {
    const cards = o.self.hand.filter(
      (c) =>
        o.phase === 'offer' ||
        (c.artist === o.auction!.cards[0].artist && c.type !== 'double'),
    );
    // Reproducible variety from permitted information, rather than strategic ranking.
    let hash = o.round * 97 + o.publicLog.length * 31;
    for (const c of cards)
      for (const letter of c.id)
        hash = (Math.imul(hash, 33) + letter.charCodeAt(0)) >>> 0;
    const card = cards[hash % cards.length];
    if (o.phase === 'pair')
      return { type: 'pair', player, card: card?.id ?? null };
    if (!card) throw new Error('AI 没有可出的牌');
    return { type: 'offer', player, card: card.id };
  }
  const a = o.auction!;
  const value = estimate(o, a.cards[0].artist) * a.cards.length;
  const limit = Math.max(
    0,
    Math.floor(
      Math.min(
        value * (relaxed ? 0.25 : 0.45),
        o.self.cash * (relaxed ? 0.15 : 0.3),
      ),
    ),
  );
  if (o.phase === 'price')
    return {
      type: 'price',
      player,
      amount: Math.min(
        o.self.cash,
        Math.max(0, Math.floor(value * (relaxed ? 0.22 : 0.35))),
      ),
    };
  if (a.type === 'fixed')
    return { type: 'buy', player, accept: a.price! <= limit };
  if (a.type === 'sealed')
    return {
      type: 'bid',
      player,
      amount: Math.min(limit, Math.floor(value * (relaxed ? 0.15 : 0.3))),
    };
  return { type: 'bid', player, amount: a.high < limit ? a.high + 1 : null };
}

export function chooseConfiguredAction(
  o: Observation,
  config?: AIConfig,
): Action {
  if (!config) return baseline(o);
  if (config.level) return chooseLevelAction(o, config.level);
  const style = config.personalities[o.self.id] ?? 'balanced';
  if (style === 'novice' || style === 'relaxed')
    return chooseGentleAction(o, style === 'relaxed');
  const base = config.difficulty === 'easy' ? legacy(o) : baseline(o);
  if (o.phase === 'offer' || o.phase === 'pair') return base;
  if (style === 'classic' && config.difficulty !== 'adaptive') return base;
  const a = o.auction!;
  const value = estimate(o, a.cards[0].artist) * a.cards.length;
  const limit = Math.min(
    o.self.cash,
    Math.max(0, Math.floor(value * risk[style])),
  );
  // Seat-independent style parameters. Standard uses the established local policy.
  if (config.difficulty !== 'adaptive') {
    if (base.type === 'price')
      return {
        ...base,
        amount: Math.min(
          o.self.cash,
          Math.round(
            value *
              (style === 'bold' ? 0.73 : style === 'cautious' ? 0.58 : 0.65),
          ),
        ),
      };
    if (base.type === 'buy') return { ...base, accept: a.price! <= limit };
    if (base.type === 'bid') {
      if (a.type === 'sealed')
        return {
          ...base,
          amount: Math.min(
            limit,
            Math.round(
              value *
                (style === 'cautious' ? 0.43 : style === 'bold' ? 0.57 : 0.5),
            ),
          ),
        };
      if (a.high >= limit || (a.seller === o.self.id && base.amount === null))
        return { ...base, amount: null };
      return {
        ...base,
        amount:
          a.type === 'once'
            ? Math.min(limit, Math.max(a.high + 1, Math.round(limit * 0.76)))
            : Math.min(
                limit,
                a.high +
                  Math.max(1, Math.min(10, Math.ceil((limit - a.high) / 4))),
              ),
      };
    }
    return base;
  }
  // Adaptive bidding is opt-in until independent strength validation supports promotion.
  const cash = publicCash(o);
  const opponents = o.players.filter((p) => p.id !== o.self.id);
  const thresholds = opponents.map((p) =>
    Math.min(cash[p.id], willingness(o, p.id, value)),
  );
  if (o.phase === 'price') {
    let best = 0,
      bestScore = -Infinity;
    for (
      let price = 0;
      price <= Math.min(o.self.cash, Math.ceil(value * 1.15));
      price++
    ) {
      let remaining = 1,
        score = 0;
      for (let offset = 1; offset < o.players.length; offset++) {
        const id = (o.self.id + offset) % o.players.length;
        const threshold = Math.min(cash[id], willingness(o, id, value));
        const probability =
          price > cash[id]
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  0.5 + (threshold - price) / Math.max(8, value * 0.5),
                ),
              );
        const rivalBenefit = Math.max(0, value - price);
        score +=
          remaining *
          probability *
          (price - (style === 'control' ? 0.35 : 0.12) * rivalBenefit);
        remaining *= 1 - probability;
      }
      score += remaining * (value - price); // Nobody buys: seller pays bank.
      if (score > bestScore) {
        bestScore = score;
        best = price;
      }
    }
    return { type: 'price', player: o.self.id, amount: best };
  }
  if (a.type === 'sealed') {
    let best = 0,
      score = 0;
    for (let bid = 0; bid <= limit; bid++) {
      const win = thresholds.reduce(
        (p, threshold) =>
          p *
          Math.max(
            0,
            Math.min(1, 0.5 + (bid - threshold) / Math.max(8, value * 0.65)),
          ),
        1,
      );
      // Seller's alternative is receiving another bidder's payment.
      const alternative =
        a.seller === o.self.id ? Math.max(0, ...thresholds) * 0.75 : 0;
      const utility = win * (value - bid - alternative);
      if (utility > score) {
        score = utility;
        best = bid;
      }
    }
    return { type: 'bid', player: o.self.id, amount: best };
  }
  if (a.type === 'fixed') {
    const price = a.price!;
    const reserve =
      o.round < 4 && style === 'cautious'
        ? Math.min(15, o.self.cash * 0.15)
        : 0;
    return {
      type: 'buy',
      player: o.self.id,
      accept: price <= limit && price <= o.self.cash - reserve,
    };
  }
  return chooseConfiguredAction(o, { ...config, difficulty: 'standard' });
}
