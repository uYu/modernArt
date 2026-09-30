import { actor, advanceSimulation, observe, ranking } from './engine.ts';
import { chooseAction as local, estimate } from './ai-legacy.ts';
import { chooseImprovedAction } from './ai-improved.ts';
import { publicCash } from './ai-search.ts';
import {
  candidateActions,
  observationSeed,
  sampleWorld,
} from './ai-planning.ts';
import { random } from './data.ts';
import type { Action, Card, GameState, Observation } from './types.ts';

export const TACTICAL_VERSION = 'offer-two-decisions-v1';
export interface TacticalOptions {
  samples?: number;
  replySamples?: number;
  /** Infinity completes all requested samples without a time cutoff. */
  budgetMs?: number;
  depth?: 1 | 2;
}
export interface TacticalResult {
  action: Action;
  reference: Action;
  completedSamples: number;
  nextDecisionSearches: number;
  elapsedMs: number;
  candidates: { action: Action; mean: number; gain: number }[];
}

function settlementValues(o: Observation, counts: number[]) {
  const ranks = ranking(counts);
  return counts.map((_, a) =>
    ranks.includes(a)
      ? 30 - ranks.indexOf(a) * 10 + o.awards.reduce((s, row) => s + row[a], 0)
      : 0,
  );
}

// A small, explicit carry-over proxy, not a prediction of full-game profit.
function reserve(hand: Card[], awards: number[][]) {
  return hand.reduce(
    (sum, c) =>
      sum + 0.12 * (15 + awards.reduce((s, row) => s + row[c.artist], 0)),
    0,
  );
}

function relative(wealth: number[], me: number, weight: number) {
  return wealth[me] - weight * Math.max(...wealth.filter((_, id) => id !== me));
}

function seasonScore(s: GameState, me: number) {
  if (s.phase !== 'roundEnd') throw new Error('Expected settled season');
  const cash = s.players.map((p) => p.cash);
  if (s.round === 4) {
    const best = Math.max(...cash);
    const win =
      cash[me] === best ? 1 / cash.filter((v) => v === best).length : 0;
    // Victory dominates the tiny margin tie-break, including tied victories.
    return win + 0.001 * Math.tanh(relative(cash, me, 1) / 100);
  }
  const awards = s.history.map((r) => r.awards);
  return relative(
    s.players.map((p) => p.cash + reserve(p.hand, awards)),
    me,
    0.65,
  );
}

/** Cheap observation-only rollout policy. Candidate ranking changes and immediate
 * settlement use all public portfolios. Actual payments/ownership are applied by
 * the engine after this policy chooses; the local sale estimate is only a prior. */
export function tacticalContinuation(o: Observation, style = 1): Action {
  if (o.phase !== 'offer' && o.phase !== 'pair') {
    const a = local(o);
    const factor = [0.8, 1, 1.2][style] ?? 1;
    if ((a.type === 'bid' || a.type === 'price') && a.amount !== null) {
      const amount = Math.min(o.self.cash, Math.round(a.amount * factor));
      return a.type === 'bid' &&
        o.auction!.type !== 'sealed' &&
        amount <= o.auction!.high
        ? { ...a, amount: null }
        : { ...a, amount };
    }
    if (a.type === 'buy')
      return {
        ...a,
        accept:
          o.auction!.price! <=
          Math.min(
            o.self.cash,
            estimate(o, o.auction!.cards[0].artist) *
              o.auction!.cards.length *
              0.82 *
              factor,
          ),
      };
    return a;
  }
  const me = o.self.id;
  const cash = publicCash(o);
  const weight = o.round === 4 ? 1 : ([0.25, 0.65, 1][style] ?? 0.65);
  let best = candidateActions(o)[0];
  let bestScore = -Infinity;
  for (const action of candidateActions(o)) {
    if (action.type !== 'offer' && action.type !== 'pair') continue;
    const card = o.self.hand.find((c) => c.id === action.card);
    const hand = o.self.hand.filter((c) => c.id !== action.card);
    const counts = [...o.counts];
    if (card) counts[card.artist]++;
    const lot = [
      ...(o.phase === 'pair' ? o.auction!.cards : []),
      ...(card ? [card] : []),
    ];
    const ends =
      counts.some((n) => n >= 5) ||
      o.players.reduce((sum, p) => sum + p.handCount, 0) === (card ? 1 : 0);
    const view = { ...o, counts, self: { ...o.self, hand } };
    const values = ends
      ? settlementValues(o, counts)
      : counts.map((_, a) => estimate(view, a));
    const wealth = cash.map(
      (c, id) =>
        c + o.players[id].collection.reduce((s, c) => s + values[c.artist], 0),
    );
    if (
      ends &&
      o.round === 4 &&
      wealth[me] > Math.max(...wealth.filter((_, id) => id !== me))
    )
      return action;
    if (!ends && lot.length) {
      const seller = card ? me : o.auction!.seller;
      const value = values[lot[0].artist] * lot.length;
      const buyers = o.players.filter(
        (p) => p.id !== seller && cash[p.id] >= value * 0.55,
      );
      if (buyers.length) {
        wealth[seller] += value * 0.55;
        for (const p of buyers) wealth[p.id] += (value * 0.45) / buyers.length;
      } else wealth[seller] += value;
    }
    const score =
      relative(wealth, me, weight) +
      (o.round < 4 ? reserve(hand, o.awards) : 0);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function finishSeason(s: GameState, styles: number[]) {
  let steps = 0;
  while (s.phase !== 'roundEnd') {
    if (++steps > 3000) throw new Error('Tactical rollout did not terminate');
    const id = actor(s)!;
    advanceSimulation(s, tacticalContinuation(observe(s, id), styles[id]));
  }
}

function stylesFor(seed: number, count: number) {
  const rng = random(seed ^ 0x81ab);
  return Array.from({ length: count }, () => Math.floor(rng() * 3));
}

/** Re-plan the next offer using fresh worlds from that player's observation.
 * The outer sampled state/hands are deliberately not arguments to this function.
 * Thus actions cannot branch on private cards the actor has not observed. */
export function nextTacticalOffer(o: Observation, samples = 2): Action {
  if (o.phase !== 'offer') throw new Error('Expected next offer');
  if (!Number.isSafeInteger(samples) || samples < 1)
    throw new Error('Invalid reply samples');
  const reference = tacticalContinuation(o);
  const actions = orderedActions(o, reference);
  const totals = actions.map(() => 0);
  const seed = observationSeed(o);
  for (let sample = 0; sample < samples; sample++) {
    const worldSeed = (seed + Math.imul(sample + 1, 2654435761)) >>> 0;
    const world = sampleWorld(o, worldSeed);
    const styles = stylesFor(worldSeed, o.players.length);
    styles[o.self.id] = 1;
    for (let i = 0; i < actions.length; i++) {
      const s = structuredClone(world);
      advanceSimulation(s, actions[i]);
      finishSeason(s, styles);
      totals[i] += seasonScore(s, o.self.id);
    }
  }
  let selected = 0;
  for (let i = 1; i < totals.length; i++)
    if (totals[i] > totals[selected] + 1e-9) selected = i;
  return actions[selected];
}

function orderedActions(o: Observation, reference: Action) {
  const key = (a: Action) => {
    if (a.type !== 'offer' && a.type !== 'pair')
      throw new Error('Expected card action');
    const c = o.self.hand.find((c) => c.id === a.card);
    return c ? `${c.artist}:${c.type}` : 'pass';
  };
  const seen = new Set([key(reference)]);
  return [
    reference,
    ...candidateActions(o).filter((a) => {
      const k = key(a);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  ];
}

/** Paired root comparison with one additional own offering decision. Other actors
 * and all later actions use the cheap tactical policy, through the real engine.
 * The wall-clock budget is soft and checked only after a whole paired world. */
export function searchTacticalOffer(
  o: Observation,
  options: TacticalOptions = {},
): TacticalResult {
  const started = performance.now();
  if (o.phase !== 'offer' && o.phase !== 'pair')
    throw new Error('Expected offer or pair');
  const samples = options.samples ?? 8;
  const replySamples = options.replySamples ?? 2;
  const budget = options.budgetMs ?? 1000;
  const depth = options.depth ?? 2;
  if (
    ![samples, replySamples].every((n) => Number.isSafeInteger(n) && n > 0) ||
    Number.isNaN(budget) ||
    budget <= 0 ||
    ![1, 2].includes(depth)
  )
    throw new Error('Invalid tactical budget');
  const reference = chooseImprovedAction(o);
  const actions = orderedActions(o, reference);
  const scores = actions.map(() => [] as number[]);
  const seed = observationSeed(o);
  const replies = new Map<string, Action>();
  let nextDecisionSearches = 0;
  let completedSamples = 0;
  for (let sample = 0; sample < samples; sample++) {
    if (sample > 0 && performance.now() - started >= budget) break;
    const worldSeed = (seed + Math.imul(sample + 1, 2654435761)) >>> 0;
    const world = sampleWorld(o, worldSeed);
    const styles = stylesFor(worldSeed, o.players.length);
    styles[o.self.id] = 1;
    for (let i = 0; i < actions.length; i++) {
      const s = structuredClone(world);
      advanceSimulation(s, actions[i]);
      let replanned = false;
      let steps = 0;
      while (s.phase !== 'roundEnd') {
        if (++steps > 3000)
          throw new Error('Tactical search did not terminate');
        const id = actor(s)!;
        const view = observe(s, id);
        let action: Action;
        if (
          depth === 2 &&
          !replanned &&
          id === o.self.id &&
          s.phase === 'offer'
        ) {
          const key = JSON.stringify(view);
          action = replies.get(key) ?? nextTacticalOffer(view, replySamples);
          if (!replies.has(key)) {
            replies.set(key, action);
            nextDecisionSearches++;
          }
          replanned = true;
        } else action = tacticalContinuation(view, styles[id]);
        advanceSimulation(s, action);
      }
      scores[i].push(seasonScore(s, o.self.id));
    }
    completedSamples++;
  }
  const mean = scores.map(
    (row) => row.reduce((sum, x) => sum + x, 0) / completedSamples,
  );
  let selected = 0;
  // A single sampled world is insufficient evidence to replace the formal expert.
  if (completedSamples >= 2)
    for (let i = 1; i < actions.length; i++) {
      const gain = mean[i] - mean[0];
      const differences = scores[i].map((v, j) => v - scores[0][j]);
      const error = Math.sqrt(
        differences.reduce((sum, v) => sum + (v - gain) ** 2, 0) /
          (completedSamples - 1) /
          completedSamples,
      );
      if (
        gain > Math.max(o.round === 4 ? 0.005 : 1.5, error) &&
        mean[i] > mean[selected]
      )
        selected = i;
    }
  return {
    action: actions[selected],
    reference,
    completedSamples,
    nextDecisionSearches,
    elapsedMs: performance.now() - started,
    candidates: actions.map((action, i) => ({
      action,
      mean: mean[i],
      gain: mean[i] - mean[0],
    })),
  };
}
