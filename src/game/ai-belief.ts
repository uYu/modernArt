import { sampleWorld } from './ai-planning.ts';
import { random } from './data.ts';
import { offerScore } from './ai-legacy.ts';
import type { Card, GameState, Observation } from './types.ts';

export const BELIEF_VERSION = 'same-season-offer-belief-v1';
export interface BeliefWorld {
  world: GameState;
  styles: number[];
}

/** Reconstruct each sampled player's earlier hand within this season.
 * There is no draw within a season, so add this season's publicly played cards
 * to the sampled current hand, then remove each card as its play is observed.
 * Earlier seasons are excluded because their intervening draws are unknown.
 */
export function offerLogLikelihood(o: Observation, world: GameState): number {
  const events = o.publicPlays.filter((event) => event.round === o.round);
  if (!events.length) return 0;
  const hands: Card[][] = world.players.map((p) => [...p.hand]);
  for (const event of events)
    if (event.card) hands[event.player].push(event.card);
  let logWeight = 0;
  const seen = new Array(o.players.length).fill(0);
  for (const event of events) {
    const hand = hands[event.player];
    if (event.phase === 'pair' && !event.card && event.player !== o.self.id) {
      const hasPair = hand.some(
        (card) => card.artist === event.pairArtist && card.type !== 'double',
      );
      logWeight += Math.log(hasPair ? 0.2 : 0.9);
    }
    if (event.phase === 'offer' && event.player !== o.self.id && event.card) {
      const chosenCard = event.card;
      const eventObservation: Observation = {
        ...o,
        phase: 'offer',
        counts: event.countsBefore,
        auction: null,
        self: {
          ...world.players[event.player],
          hand,
          collection: event.collectionsBefore[event.player],
        },
        players: o.players.map((p) => ({
          ...p,
          handCount: p.id === event.player ? hand.length : p.handCount,
          collection: event.collectionsBefore[p.id],
        })),
      };
      const scores = hand.map((card) => offerScore(eventObservation, card));
      const max = Math.max(...scores);
      // The model is intentionally noisy: expert search and human play do not
      // always select the card preferred by this cheap one-step evaluator.
      const temperature = 5;
      const exp = scores.map((score) => Math.exp((score - max) / temperature));
      const sum = exp.reduce((a, b) => a + b, 0);
      const chosen = hand.findIndex((card) => card.id === chosenCard.id);
      if (chosen < 0) throw new Error('Public play missing from sampled hand');
      const probability = 0.2 / hand.length + 0.8 * (exp[chosen] / sum);
      // Ratio to uniform play; only relative world likelihood matters.
      // Cap evidence per opponent to avoid overconfidence in a misspecified model.
      if (seen[event.player]++ < 4)
        logWeight += Math.log(Math.max(1e-12, probability * hand.length));
    }
    if (event.card) {
      const index = hand.findIndex((card) => card.id === event.card!.id);
      if (index < 0) throw new Error('Public card conservation failed');
      hand.splice(index, 1);
    }
  }
  return logWeight;
}

function effectiveSampleSize(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  const sumSquares = weights.reduce((a, b) => a + b * b, 0);
  return (sum * sum) / sumSquares;
}

export function beliefWeights(
  o: Observation,
  worlds: GameState[],
  strength = 0.25,
): number[] {
  if (!worlds.length) throw new Error('Belief needs at least one world');
  if (!Number.isFinite(strength) || strength < 0)
    throw new Error('Invalid belief strength');
  const logWeights = worlds.map((world) => offerLogLikelihood(o, world));
  const highest = Math.max(...logWeights);
  const shifted = logWeights.map((x) => x - highest);
  let power = strength;
  let raw = shifted.map((x) => Math.exp(power * x));
  while (effectiveSampleSize(raw) < worlds.length / 2 && power > 0.05) {
    power *= 0.8;
    raw = shifted.map((x) => Math.exp(power * x));
  }
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => 0.85 * (w / total) + 0.15 / worlds.length);
}

/** Stratified posterior resampling from physically valid complete worlds. */
export function sampleBeliefWorlds(
  o: Observation,
  seed: number,
  count = 24,
  proposals = 48,
): BeliefWorld[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(proposals) ||
    proposals < count
  )
    throw new Error('Invalid belief sample count');
  const pool: BeliefWorld[] = [];
  for (let i = 0; i < proposals; i++) {
    const worldSeed = (seed + Math.imul(i + 1, 2654435761)) >>> 0;
    const styleRng = random(worldSeed ^ 0x7ac3);
    const styles = o.players.map(() => Math.floor(styleRng() * 3));
    const world = sampleWorld(o, worldSeed, styles);
    pool.push({ world, styles });
  }
  const weights = beliefWeights(
    o,
    pool.map((item) => item.world),
  );
  const rng = random(seed ^ 0xb311ef);
  const offset = rng() / count;
  const result: BeliefWorld[] = [];
  let cumulative = weights[0];
  let index = 0;
  for (let k = 0; k < count; k++) {
    const target = offset + k / count;
    while (index < proposals - 1 && cumulative < target)
      cumulative += weights[++index];
    result.push(pool[index]);
  }
  return result;
}
