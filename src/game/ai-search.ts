import { ledgerBalances } from './ledger.ts';
import { makeDeck, random } from './data.ts';
import { ranking } from './engine.ts';
import type { Action, AuctionType, Card, Observation } from './types.ts';

export const AI_VERSION = 'market-v2';
const SAMPLES = 24;
const DECK = makeDeck();
const order = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => (start + i) % n);

/** Reconstruct a ledger from events a player could have remembered, not hidden balances. */
export function publicCash(o: Observation): number[] {
  const cash = ledgerBalances(o.settledIncome, o.transactions);
  cash[o.self.id] = o.self.cash;
  return cash;
}
function seedFor(o: Observation) {
  // Independent of the actual deal seed and all hidden engine state.
  const text = JSON.stringify([
    o.round,
    o.self.id,
    o.counts,
    o.self.hand.map((c) => c.id),
    o.auction,
    o.publicLog.length,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function prices(o: Observation, counts: number[]) {
  const ranks = ranking(counts);
  return counts.map((_, a) =>
    ranks.includes(a)
      ? 30 - ranks.indexOf(a) * 10 + o.awards.reduce((v, r) => v + r[a], 0)
      : 0,
  );
}
/** A transparent relative-wealth surrogate, NOT a solved winning-probability model. */
function utility(o: Observation, wealth: number[]) {
  const rivals = wealth.filter((_, i) => i !== o.self.id);
  const max = Math.max(...rivals);
  const temperature = o.round === 4 ? 18 : 45;
  const threat =
    max +
    temperature *
      Math.log(
        rivals.reduce((v, x) => v + Math.exp((x - max) / temperature), 0) /
          rivals.length,
      );
  return wealth[o.self.id] - (o.round === 4 ? 0.8 : 0.45) * threat;
}
function estate(o: Observation, cash: number[], value: number[]) {
  return cash.map(
    (c, i) =>
      c +
      o.players[i].collection.reduce((v, card) => v + value[card.artist], 0),
  );
}

/** Sample possible hands without replacement and plausible remaining artist plays.
 * This forecasts stopping-time prices only; it does not claim full-game ISMCTS.
 */
function forecast(
  o: Observation,
  counts: number[],
  removed: Card[],
  next: number,
): number[][] {
  if (counts.some((n) => n >= 5))
    return Array.from({ length: SAMPLES }, () => prices(o, counts));
  const known = new Set([...o.revealed, ...o.self.hand].map((c) => c.id));
  const pool = DECK.filter((c) => !known.has(c.id));
  const removedIds = new Set(removed.map((c) => c.id));
  const rng = random(seedFor(o));
  const results: number[][] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const shuffled = [...pool];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    const hands = o.players.map((p) =>
      p.id === o.self.id
        ? o.self.hand.filter((c) => !removedIds.has(c.id))
        : shuffled.splice(0, p.handCount),
    );
    const c = [...counts];
    let seat = next;
    for (let step = 0; step < 70 && !c.some((n) => n >= 5); step++) {
      if (hands.every((h) => !h.length)) break;
      const hand = hands[seat];
      if (hand.length) {
        // No opponent accesses another hand; choice uses its own hand/public counts.
        let best = 0,
          score = -Infinity;
        hand.forEach((card, i) => {
          const a = card.artist;
          const holdings = o.players[seat].collection.filter(
            (x) => x.artist === a,
          ).length;
          const past = o.awards.reduce((sum, r) => sum + r[a], 0);
          const s = c[a] * 1.1 + past / 25 + holdings * 0.8 + rng() * 5;
          if (s > score) {
            score = s;
            best = i;
          }
        });
        const card = hand.splice(best, 1)[0];
        c[card.artist]++;
        // Local double option; distant seller takeovers remain model uncertainty.
        if (card.type === 'double' && c[card.artist] < 5) {
          const pair = hand.findIndex(
            (x) => x.artist === card.artist && x.type !== 'double',
          );
          if (pair >= 0 && rng() < 0.8) {
            hand.splice(pair, 1);
            c[card.artist]++;
          }
        }
      }
      seat = (seat + 1) % hands.length;
    }
    results.push(prices(o, c));
  }
  return results;
}

type Deal = { winner: number; amount: number };
/** Sampled opponents have heterogeneous budgets; personality is not tied to seat ID. */
function thresholds(
  o: Observation,
  cash: number[],
  value: number,
  sample: number,
) {
  const rng = random((seedFor(o) + Math.imul(sample + 1, 2654435761)) >>> 0);
  return cash.map((c) =>
    Math.max(0, Math.min(c, Math.floor(value * (0.48 + rng() * 0.52)))),
  );
}
function auctionOutcome(
  o: Observation,
  type: AuctionType,
  seller: number,
  limits: number[],
  action?: Action,
): Deal {
  const a = o.auction;
  const n = limits.length;
  const actual = action !== undefined;
  if (type === 'fixed') {
    const price = action?.type === 'price' ? action.amount : (a?.price ?? 0);
    const queue =
      actual && action.type === 'buy'
        ? a!.queue
        : order((seller + 1) % n, n).slice(0, -1);
    for (const p of queue) {
      const accept =
        p === o.self.id && action?.type === 'buy'
          ? action.accept
          : limits[p] >= price;
      if (accept) return { winner: p, amount: price };
    }
    return { winner: seller, amount: price };
  }
  if (type === 'sealed') {
    const bids = limits.map((v) => Math.floor(v * 0.73));
    if (action?.type === 'bid') bids[o.self.id] = action.amount ?? 0;
    let winner = seller;
    for (const p of order(seller, n)) if (bids[p] > bids[winner]) winner = p;
    return { winner, amount: bids[winner] };
  }
  let high = actual ? a!.high : 0;
  let winner = actual ? (a!.bidder ?? seller) : seller;
  let queue = actual ? [...a!.queue] : order((seller + 1) % n, n);
  let first = true;
  // Each accepted bid strictly increases the integer price, with finite budgets.
  while (queue.length) {
    const p = queue.shift()!;
    let amount: number | null = null;
    if (first && action?.type === 'bid') amount = action.amount;
    else if (high < limits[p])
      amount =
        type === 'once'
          ? Math.max(high + 1, Math.floor(limits[p] * 0.78))
          : high + 1;
    first = false;
    if (amount !== null) {
      high = amount;
      winner = p;
      if (type === 'open') queue = order((p + 1) % n, n).slice(0, -1);
    }
  }
  return { winner, amount: high };
}
function scoreDeal(
  o: Observation,
  cash: number[],
  value: number[],
  cards: Card[],
  seller: number,
  deal: Deal,
) {
  const wealth = estate(o, cash, value);
  wealth[deal.winner] += cards.length * value[cards[0].artist] - deal.amount;
  if (deal.winner !== seller) wealth[seller] += deal.amount;
  return utility(o, wealth);
}
function bidCandidates(cash: number, value: number, minimum = 0) {
  const set = new Set([minimum]);
  for (
    let p = minimum;
    p <= Math.min(cash, Math.ceil(value));
    p += Math.max(1, Math.floor(value / 20))
  )
    set.add(p);
  return [...set].filter((p) => p <= cash);
}

export function chooseAction(o: Observation): Action {
  const me = o.self.id;
  const cash = publicCash(o);
  const a = o.auction;
  if (o.phase === 'offer' || o.phase === 'pair') {
    const choices =
      o.phase === 'offer'
        ? o.self.hand
        : o.self.hand.filter(
            (c) => c.artist === a!.cards[0].artist && c.type !== 'double',
          );
    let best: Action =
      o.phase === 'pair'
        ? { type: 'pair', player: me, card: null }
        : { type: 'offer', player: me, card: choices[0].id };
    let bestScore = -Infinity;
    const candidates: { card: Card | null; pair?: Card }[] = [];
    if (o.phase === 'pair') candidates.push({ card: null });
    for (const card of choices) {
      candidates.push({ card });
      if (
        o.phase === 'offer' &&
        card.type === 'double' &&
        o.counts[card.artist] < 4
      )
        for (const pair of o.self.hand.filter(
          (c) => c.artist === card.artist && c.type !== 'double',
        ))
          candidates.push({ card, pair });
    }
    for (const { card, pair } of candidates) {
      const counts = [...o.counts];
      const removed = [card, pair].filter((c): c is Card => !!c);
      const cards =
        o.phase === 'pair' ? [...a!.cards, ...removed] : [...removed];
      const seller = card ? me : a!.seller;
      const type = pair?.type ?? card?.type ?? 'double';
      for (const c of removed) counts[c.artist]++;
      const handTotal =
        o.players.reduce((sum, p) => sum + p.handCount, 0) - removed.length;
      const ends = counts.some((n) => n >= 5) || handTotal === 0;
      if (ends && o.round === 4) {
        const finalWealth = estate(o, cash, prices(o, counts));
        if (
          finalWealth[me] > Math.max(...finalWealth.filter((_, i) => i !== me))
        )
          return {
            type: o.phase === 'offer' ? 'offer' : 'pair',
            player: me,
            card: card?.id ?? null,
          } as Action;
      }
      const projected = ends
        ? Array.from({ length: SAMPLES }, () => prices(o, counts))
        : forecast(o, counts, removed, (seller + 1) % cash.length);
      let total = 0;
      for (let sample = 0; sample < SAMPLES; sample++) {
        let value = projected[sample];
        let lot = cards,
          owner = seller,
          mechanism = type;
        if (ends) {
          total += utility(o, estate(o, cash, value));
          continue;
        }
        if (type === 'double') {
          // Sample actual possible matching cards, in the remaining pairing order.
          const known = new Set(
            [...o.revealed, ...o.self.hand].map((c) => c.id),
          );
          const pool = DECK.filter((c) => !known.has(c.id));
          const rng = random((seedFor(o) + sample * 8191) >>> 0);
          for (let k = pool.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [pool[k], pool[j]] = [pool[j], pool[k]];
          }
          const hands = o.players.map((p) =>
            p.id === me ? [] : pool.splice(0, p.handCount),
          );
          const queue =
            o.phase === 'pair'
              ? a!.queue.slice(1)
              : order((me + 1) % cash.length, cash.length).slice(0, -1);
          let completion: Card | undefined;
          for (const p of queue) {
            const match = hands[p].find(
              (c) => c.artist === cards[0].artist && c.type !== 'double',
            );
            if (match && rng() < 0.8) {
              completion = match;
              owner = p;
              break;
            }
          }
          if (!completion) {
            total += scoreDeal(o, cash, value, cards, seller, {
              winner: seller,
              amount: 0,
            });
            continue;
          }
          lot = [...cards, completion];
          mechanism = completion.type;
          const pairedCounts = [...counts];
          pairedCounts[completion.artist]++;
          if (pairedCounts.some((n) => n >= 5) || handTotal === 1) {
            total += utility(o, estate(o, cash, prices(o, pairedCounts)));
            continue;
          }
          // Condition the continuation on the publicly hypothesized pairing.
          const hypothetical = {
            ...o,
            revealed: [...o.revealed, completion],
            players: o.players.map((p) =>
              p.id === owner ? { ...p, handCount: p.handCount - 1 } : p,
            ),
          };
          value = forecast(
            hypothetical,
            pairedCounts,
            removed,
            (owner + 1) % cash.length,
          )[sample];
        }
        const limits = thresholds(
          o,
          cash,
          value[lot[0].artist] * lot.length,
          sample,
        );
        let deal: Deal;
        if (mechanism === 'fixed') {
          const price = Math.min(
            cash[owner],
            Math.floor(value[lot[0].artist] * lot.length * 0.7),
          );
          const buyer = order((owner + 1) % cash.length, cash.length)
            .slice(0, -1)
            .find((p) => limits[p] >= price);
          deal = { winner: buyer ?? owner, amount: price };
        } else deal = auctionOutcome(o, mechanism, owner, limits);
        total += scoreDeal(o, cash, value, lot, owner, deal);
      }
      const opportunity =
        o.round < 4
          ? removed.reduce(
              (sum, c) =>
                sum + o.awards.reduce((v, r) => v + r[c.artist], 0) * 0.04 + 1,
              0,
            )
          : 0;
      const score = total / SAMPLES - opportunity;
      if (score > bestScore) {
        bestScore = score;
        best = {
          type: o.phase === 'offer' ? 'offer' : 'pair',
          player: me,
          card: card?.id ?? null,
        } as Action;
      }
    }
    return best;
  }
  if (!a) throw new Error('缺少拍卖');
  const projected = forecast(o, o.counts, [], (a.seller + 1) % cash.length);
  const mean =
    projected.reduce(
      (sum, v) => sum + v[a.cards[0].artist] * a.cards.length,
      0,
    ) / SAMPLES;
  let candidates: Action[];
  if (o.phase === 'price')
    candidates = bidCandidates(o.self.cash, mean).map((amount) => ({
      type: 'price',
      player: me,
      amount,
    }));
  else if (a.type === 'fixed')
    candidates = [false, true]
      .filter((accept) => !accept || a.price! <= o.self.cash)
      .map((accept) => ({ type: 'buy', player: me, accept }));
  else {
    const amounts: (number | null)[] =
      a.type === 'sealed'
        ? bidCandidates(o.self.cash, mean)
        : [
            null,
            ...(a.type === 'open'
              ? [a.high + 1].filter((p) => p <= o.self.cash)
              : bidCandidates(o.self.cash, mean, a.high + 1)),
          ];
    candidates = amounts.map((amount) => ({ type: 'bid', player: me, amount }));
  }
  let best = candidates[0],
    bestScore = -Infinity;
  for (const action of candidates) {
    let total = 0;
    for (let sample = 0; sample < SAMPLES; sample++) {
      const value = projected[sample];
      const limits = thresholds(
        o,
        cash,
        value[a.cards[0].artist] * a.cards.length,
        sample,
      );
      // Our continuation after a public raise uses a conservative reservation.
      limits[me] = Math.min(
        o.self.cash,
        Math.floor(mean * (a.seller === me ? 0.55 : 0.85)),
      );
      const deal = auctionOutcome(o, a.type, a.seller, limits, action);
      total += scoreDeal(o, cash, value, a.cards, a.seller, deal);
    }
    const score = total / SAMPLES;
    if (score > bestScore + 1e-8) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}
