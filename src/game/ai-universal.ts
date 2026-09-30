import { chooseImprovedAction } from './ai-improved.ts';
import { beliefWeights, sampleBeliefWorlds } from './ai-belief.ts';
import { observationSeed, sampleWorld } from './ai-planning.ts';
import { random } from './data.ts';
import { actor, advanceSimulation, observe } from './engine.ts';
import { chooseAction as chooseCheapAction, estimate } from './ai-legacy.ts';
import type { Action, Observation } from './types.ts';

export const UNIVERSAL_AUCTION_VERSION = 'auction-search-v1';
export interface AuctionSearchOptions {
  samples?: number;
  /** Infinity completes all requested samples without a time cutoff. */
  budgetMs?: number;
  belief?: 'uniform' | 'played' | 'weighted';
  evaluation?: 'auction' | 'final-round' | 'final-win';
  reference?: Action;
}
export interface AuctionSearchResult {
  action: Action;
  reference: Action;
  completedSamples: number;
  elapsedMs: number;
  candidates: { action: Action; mean: number; gain: number }[];
}

/** One candidate interface for every actual auction decision. Narrow prices around
 * the tested expert, while retaining pass/buy and a low-price boundary. */
export function auctionCandidates(
  o: Observation,
  reference = chooseImprovedAction(o),
): Action[] {
  if (o.phase === 'offer' || o.phase === 'pair') return [reference];
  const a = o.auction!;
  if (reference.type === 'buy')
    return reference.accept || a.price! <= o.self.cash
      ? [reference, { ...reference, accept: !reference.accept }]
      : [reference];
  if (reference.type !== 'bid' && reference.type !== 'price')
    return [reference];
  const out: Action[] = [reference];
  const seen = new Set([JSON.stringify(reference)]);
  const add = (amount: number | null) => {
    if (reference.type === 'price' && amount === null) return;
    if (
      amount !== null &&
      (!Number.isSafeInteger(amount) || amount < 0 || amount > o.self.cash)
    )
      return;
    if (
      reference.type === 'bid' &&
      a.type !== 'sealed' &&
      amount !== null &&
      amount <= a.high
    )
      return;
    const action = { ...reference, amount } as Action;
    const key = JSON.stringify(action);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(action);
    }
  };
  if (reference.type === 'price') {
    const p = reference.amount;
    for (const delta of [-10, -5, -1, 1, 5, 10]) add(p + delta);
    add(0);
  } else if (a.type === 'sealed') {
    const p = reference.amount ?? 0;
    for (const delta of [-8, -3, -1, 1, 3, 8]) add(p + delta);
    add(0);
  } else {
    add(null);
    add(a.high + 1);
    if (reference.amount !== null) {
      add(Math.ceil((a.high + reference.amount) / 2));
      add(reference.amount + 5);
    }
  }
  // All generated actions are legal, but the baseline may be outside the
  // abstraction in candidateActions; it remains our preferred fallback.
  return out;
}
function continuation(o: Observation, style: number, cheap = false): Action {
  const base = cheap ? chooseCheapAction(o) : chooseImprovedAction(o);
  if (style === 1 || (base.type !== 'bid' && base.type !== 'price'))
    return base;
  if (base.amount === null) return base;
  const factor = style === 0 ? 0.8 : 1.2;
  const amount = Math.min(o.self.cash, Math.round(base.amount * factor));
  return base.type === 'bid' &&
    o.auction!.type !== 'sealed' &&
    amount <= o.auction!.high
    ? { ...base, amount: null }
    : { ...base, amount };
}

/** Paired local auction search. Rules, payment and turn order come exclusively
 * from advanceSimulation. Each actor sees only its own Observation. */
export function searchAuction(
  o: Observation,
  options: AuctionSearchOptions = {},
): AuctionSearchResult {
  const started = performance.now();
  const reference = options.reference ?? chooseImprovedAction(o);
  const actions = auctionCandidates(o, reference);
  const scores = actions.map(() => [] as number[]);
  if (actions.length === 1)
    return {
      action: reference,
      reference,
      completedSamples: 0,
      elapsedMs: performance.now() - started,
      candidates: [{ action: reference, mean: 0, gain: 0 }],
    };
  const samples = options.samples ?? 24;
  const budget = options.budgetMs ?? 180;
  const finalWin = options.evaluation === 'final-win';
  const finalRound = options.evaluation === 'final-round' || finalWin;
  if (finalRound && o.round !== 4)
    throw new Error('Final-round evaluation requires round four');
  if (
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    Number.isNaN(budget) ||
    budget <= 0
  )
    throw new Error('Invalid auction search budget');
  const seed = observationSeed(o);
  const useBelief =
    options.belief === 'played' &&
    o.publicPlays.some(
      (play) => play.round === o.round && play.player !== o.self.id,
    );
  const beliefWorlds = useBelief
    ? sampleBeliefWorlds(o, seed, samples, Math.max(48, samples * 2))
    : null;
  // Direct importance weights keep exactly the same proposed worlds as the
  // uniform branch; unlike 'played', this does not resample or duplicate them.
  const weightedWorlds =
    options.belief === 'weighted'
      ? Array.from({ length: samples }, (_, sample) => {
          const worldSeed = (seed + Math.imul(sample + 1, 2654435761)) >>> 0;
          const styleRng = random(worldSeed ^ 0x7ac3);
          const styles = o.players.map(() => Math.floor(styleRng() * 3));
          return { world: sampleWorld(o, worldSeed, styles), styles };
        })
      : null;
  const weights = weightedWorlds
    ? beliefWeights(
        o,
        weightedWorlds.map((item) => item.world),
      )
    : null;
  const values = o.counts.map((_, artist) => estimate(o, artist));
  const weight = o.round === 4 ? 0.8 : 0.35;
  const me = o.self.id;
  let completed = 0;
  for (let sample = 0; sample < samples; sample++) {
    if (sample > 0 && performance.now() - started >= budget) break;
    const worldSeed = (seed + Math.imul(sample + 1, 2654435761)) >>> 0;
    const styleRng = random(worldSeed ^ 0x7ac3);
    const styles =
      (beliefWorlds ?? weightedWorlds)?.[sample].styles ??
      o.players.map(() => Math.floor(styleRng() * 3));
    const world =
      (beliefWorlds ?? weightedWorlds)?.[sample].world ??
      sampleWorld(o, worldSeed, styles);
    // Sealed bids are simultaneous. Cache each future player's private choice
    // once per world; our candidate amount is not public before revelation.
    const sealedActions = new Map<number, Action>();
    if (world.auction?.type === 'sealed')
      for (const id of world.auction.queue.slice(1))
        sealedActions.set(id, continuation(observe(world, id), styles[id]));
    const sampleScores: number[] = [];
    for (const action of actions) {
      const state = structuredClone(world);
      advanceSimulation(state, action);
      let steps = 0;
      while (state.auction) {
        if (++steps > 2000)
          throw new Error('Auction simulation did not terminate');
        const id = actor(state)!;
        advanceSimulation(
          state,
          sealedActions.get(id) ?? continuation(observe(state, id), styles[id]),
        );
      }
      if (finalRound) {
        // Continue from the same sampled world, through actual season settlement.
        // Every simulated player, including the root player, acts only from its
        // own observation. No recursive auction search is used in the rollout.
        while (state.phase !== 'roundEnd') {
          if (++steps > 300)
            throw new Error('Final-round rollout did not terminate');
          const id = actor(state)!;
          advanceSimulation(
            state,
            continuation(observe(state, id), styles[id], true),
          );
        }
      }
      const wealth = state.players.map((p) =>
        finalRound
          ? p.cash
          : p.cash + p.collection.reduce((sum, c) => sum + values[c.artist], 0),
      );
      if (finalWin) {
        const best = Math.max(...wealth);
        const tied = wealth.filter((cash) => cash === best).length;
        sampleScores.push(wealth[me] === best ? 1 / tied : 0);
      } else
        sampleScores.push(
          wealth[me] - weight * Math.max(...wealth.filter((_, i) => i !== me)),
        );
    }
    for (let i = 0; i < actions.length; i++) scores[i].push(sampleScores[i]);
    completed++;
  }
  if (!completed) throw new Error('No auction scenarios completed');
  const completedWeights = weights
    ? weights.slice(0, completed)
    : Array.from({ length: completed }, () => 1 / completed);
  const weightTotal = completedWeights.reduce((sum, value) => sum + value, 0);
  const normalizedWeights = completedWeights.map(
    (value) => value / weightTotal,
  );
  const effectiveSamples =
    1 / normalizedWeights.reduce((sum, value) => sum + value * value, 0);
  const mean = scores.map((x) =>
    weights
      ? x.reduce((sum, value, i) => sum + value * normalizedWeights[i], 0)
      : x.reduce((sum, value) => sum + value, 0) / x.length,
  );
  let selected = 0;
  for (let i = 1; i < actions.length; i++) {
    const gain = mean[i] - mean[0];
    const differences = scores[i].map((value, j) => value - scores[0][j]);
    const uncertainty = weights
      ? Math.sqrt(
          differences.reduce(
            (sum, value, j) => sum + normalizedWeights[j] * (value - gain) ** 2,
            0,
          ) /
            Math.max(1e-12, 1 - 1 / effectiveSamples) /
            effectiveSamples,
        )
      : Math.sqrt(
          differences.reduce((sum, value) => sum + (value - gain) ** 2, 0) /
            Math.max(1, completed - 1) /
            completed,
        );
    // Preserve the tested expert when evidence for changing its action is weak.
    if (
      gain > Math.max(finalWin ? 0.001 : 1.5, uncertainty) &&
      mean[i] > mean[selected]
    )
      selected = i;
  }
  return {
    action: actions[selected],
    reference,
    completedSamples: completed,
    elapsedMs: performance.now() - started,
    candidates: actions.map((action, i) => ({
      action,
      mean: mean[i],
      gain: mean[i] - mean[0],
    })),
  };
}
export function chooseUniversalAction(o: Observation): Action {
  return o.phase === 'offer' || o.phase === 'pair'
    ? chooseImprovedAction(o)
    : searchAuction(o).action;
}
