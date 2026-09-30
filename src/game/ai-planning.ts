import { makeDeck, random } from './data.ts';
import { actor, advanceSimulation, observe } from './engine.ts';
import { chooseAction as local, estimate } from './ai-legacy.ts';
import { publicCash } from './ai-search.ts';
import type { Action, GameState, Observation } from './types.ts';

export const PLANNING_VERSION = 'planning-v1';
export type PlanningMode = 'rollout' | 'ismcts';
export interface PlanningOptions {
  mode: PlanningMode;
  iterations?: number;
  timeMs?: number;
  seed?: number;
  treeDepth?: number;
}
type Stat = { action: Action; visits: number; total: number };
export interface PlanningResult {
  action: Action;
  simulations: number;
  elapsedMs: number;
  treeNodes: number;
  treeSelections: number;
  treeRevisits: number;
  candidates: { action: Action; visits: number; mean: number | null }[];
}
export function observationSeed(o: Observation): number {
  let hash = 2166136261;
  // The structured public history was added later. Preserve the existing
  // uniform-search policy's seed when its decision inputs are otherwise equal.
  const { publicPlays: _publicPlays, ...previousObservation } = o;
  for (const c of JSON.stringify(previousObservation))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// Each continuation actor receives only its own observation. Styles are sampled
// independently of seat and held fixed for the entire sampled game.
function policy(o: Observation, style: number): Action {
  const action = local(o);
  if (
    action.type === 'price' ||
    (action.type === 'bid' && action.amount !== null)
  ) {
    const scale = [0.8, 1, 1.2][style];
    const amount = Math.min(o.self.cash, Math.round(action.amount! * scale));
    if (action.type === 'bid' && o.auction!.type !== 'sealed')
      return { ...action, amount: amount > o.auction!.high ? amount : null };
    return { ...action, amount };
  }
  if (action.type === 'buy')
    return {
      ...action,
      accept:
        o.auction!.price! <=
        Math.min(
          o.self.cash,
          estimate(o, o.auction!.cards[0].artist) *
            o.auction!.cards.length *
            [0.65, 0.82, 0.95][style],
        ),
    };
  return action;
}

/** Construct a possible world exclusively from permitted information.
 * Historical result rows are sufficient statistics, not fabricated replay data.
 * Never persist this state as a real game/save.
 */
export function sampleWorld(
  o: Observation,
  seed: number,
  styles?: number[],
): GameState {
  const rng = random(seed);
  const known = new Set([...o.revealed, ...o.self.hand].map((c) => c.id));
  const pool = makeDeck().filter((c) => !known.has(c.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cash = publicCash(o);
  const table = new Set(
    [
      ...o.players.flatMap((p) => p.collection),
      ...(o.auction?.cards ?? []),
    ].map((c) => c.id),
  );
  const s: GameState = {
    version: 1,
    seed: 0,
    first: 0,
    round: o.round,
    turn: o.turn,
    phase: o.phase,
    players: o.players.map((p) => ({
      id: p.id,
      name: o.names[p.id],
      cash: cash[p.id],
      hand: p.id === o.self.id ? [...o.self.hand] : pool.splice(0, p.handCount),
      collection: [...p.collection],
    })),
    deck: pool,
    discarded: o.revealed.filter((c) => !table.has(c.id)),
    counts: [...o.counts],
    history: o.awards.map((awards, i) => ({
      round: i + 1,
      awards: [...awards],
      income: o.players.map((_, p) => (i === 0 ? o.settledIncome[p] : 0)),
      counts: [],
      values: [],
      sold: o.players.map(() => []),
      unsold: [],
      reason: 'sampled history',
    })),
    auction: o.auction ? { ...structuredClone(o.auction), bids: {} } : null,
    log: [],
    transactions: structuredClone(o.transactions),
    publicPlays: structuredClone(o.publicPlays),
    actions: [],
    bankFlow: cash.reduce((sum, x) => sum + x, 0) - 100 * cash.length,
  };
  // Locked sealed bids are unknown; draw them from each sampled actor's policy.
  // They are never copied from the real engine or revealed to a continuation actor.
  if (s.auction?.type === 'sealed') {
    for (const p of s.players)
      if (!s.auction.queue.includes(p.id)) {
        const own = observe(s, p.id);
        const bid = policy(own, styles?.[p.id] ?? Math.floor(rng() * 3));
        s.auction.bids[p.id] = bid.type === 'bid' ? (bid.amount ?? 0) : 0;
      }
  }
  return s;
}

/** Exact card choices; bidding amounts are an explicit action abstraction. */
export function candidateActions(o: Observation): Action[] {
  const player = o.self.id;
  if (o.phase === 'roundEnd') return [{ type: 'next' }];
  if (o.phase === 'offer' || o.phase === 'pair') {
    const seen = new Set<string>();
    const actions: Action[] =
      o.phase === 'pair' ? [{ type: 'pair', player, card: null }] : [];
    for (const c of o.self.hand) {
      if (
        o.phase === 'pair' &&
        (c.artist !== o.auction!.cards[0].artist || c.type === 'double')
      )
        continue;
      const key = `${c.artist}:${c.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ type: o.phase, player, card: c.id });
    }
    return actions;
  }
  const a = o.auction!;
  if (a.type === 'fixed' && o.phase === 'bid')
    return [
      { type: 'buy', player, accept: false },
      ...(a.price! <= o.self.cash
        ? [{ type: 'buy' as const, player, accept: true }]
        : []),
    ];
  const value = estimate(o, a.cards[0].artist) * a.cards.length;
  const amounts = new Set<number>([
    0,
    ...[0.35, 0.5, 0.65, 0.8, 1].map((f) =>
      Math.min(o.self.cash, Math.round(value * f)),
    ),
  ]);
  const base = local(o);
  if ((base.type === 'bid' || base.type === 'price') && base.amount !== null)
    amounts.add(base.amount);
  if (o.phase === 'price')
    return [...amounts].map((amount) => ({ type: 'price', player, amount }));
  if (a.type === 'sealed')
    return [...amounts].map((amount) => ({ type: 'bid', player, amount }));
  if (a.high < o.self.cash) amounts.add(a.high + 1);
  return [
    { type: 'bid', player, amount: null },
    ...[...amounts]
      .filter((x) => x > a.high)
      .map((amount) => ({ type: 'bid' as const, player, amount })),
  ];
}
function step(s: GameState, a: Action): GameState {
  const next = advanceSimulation(s, a);
  // Search does not need replay/log strings. Keep public transactions and results.
  next.actions = [];
  next.log = [];
  return next;
}
function informationKey(o: Observation): string {
  // Own observation/history only: never key nodes with sampled opponents' hands.
  return JSON.stringify([
    o.round,
    o.phase,
    o.turn,
    o.self,
    o.players,
    o.counts,
    o.awards,
    o.transactions,
    o.revealed,
    o.auction,
  ]);
}
function select(stats: Stat[], rng: () => number): Stat {
  const unseen = stats.filter((s) => s.visits === 0);
  if (unseen.length) return unseen[Math.floor(rng() * unseen.length)];
  const visits = stats.reduce((sum, s) => sum + s.visits, 0);
  return stats.reduce((best, s) => {
    const score = (x: Stat) =>
      x.total / x.visits + Math.sqrt((2 * Math.log(visits)) / x.visits);
    return score(s) > score(best) ? s : best;
  });
}

/** Single-observer information-set tree against a sampled fixed opponent mixture.
 * Only the root player's decisions are optimized; opponents use observation-only
 * policies. This is not a multiplayer equilibrium solver.
 */
export function plan(o: Observation, options: PlanningOptions): PlanningResult {
  const started = performance.now();
  const actions = candidateActions(o);
  if (!actions.length) throw new Error('No planning actions');
  const stats = actions.map((action) => ({ action, visits: 0, total: 0 }));
  const trees = new Map<string, Stat[]>();
  const seed = options.seed ?? observationSeed(o);
  const rng = random(seed);
  const iterations = options.iterations ?? 96;
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error('iterations must be positive');
  let simulations = 0;
  let treeSelections = 0;
  let treeRevisits = 0;
  // Flat search uses balanced shuffled root passes and the same possible world
  // for all actions in a pass. Both methods obey the same simulation/time cap.
  let pass = [...stats];
  for (let i = pass.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pass[i], pass[j]] = [pass[j], pass[i]];
  }
  while (simulations < iterations) {
    if (
      simulations > 0 &&
      options.timeMs !== undefined &&
      performance.now() - started >= options.timeMs
    )
      break;
    const index =
      options.mode === 'rollout'
        ? Math.floor(simulations / stats.length)
        : simulations;
    const worldSeed = (seed + Math.imul(index + 1, 2654435761)) >>> 0;
    const styleRng = random(worldSeed ^ 0xabcdef);
    const styles = o.players.map(() => Math.floor(styleRng() * 3));
    let s = sampleWorld(o, worldSeed, styles);
    const root =
      options.mode === 'rollout'
        ? pass[simulations % pass.length]
        : select(stats, rng);
    const path = [root];
    s = step(s, root.action);
    let decisions = 1;
    let expanded = false;
    let steps = 0;
    while (s.phase !== 'finished') {
      if (++steps > 5000)
        throw new Error('Planning continuation did not terminate');
      if (s.phase === 'roundEnd') {
        s = step(s, { type: 'next' });
        continue;
      }
      const id = actor(s)!;
      const view = observe(s, id);
      let action: Action;
      if (
        options.mode === 'ismcts' &&
        id === o.self.id &&
        !expanded &&
        decisions < (options.treeDepth ?? 4)
      ) {
        const key = informationKey(view);
        let node = trees.get(key);
        treeSelections++;
        if (node) treeRevisits++;
        if (!node) {
          node = candidateActions(view).map((action) => ({
            action,
            visits: 0,
            total: 0,
          }));
          trees.set(key, node);
          expanded = true;
        }
        const edge = select(node, rng);
        path.push(edge);
        action = edge.action;
        decisions++;
      } else action = policy(view, styles[id]);
      s = step(s, action);
    }
    const max = Math.max(...s.players.map((p) => p.cash));
    const reward =
      s.players[o.self.id].cash === max
        ? 1 / s.players.filter((p) => p.cash === max).length
        : 0;
    for (const edge of path) {
      edge.visits++;
      edge.total += reward;
    }
    simulations++;
  }
  const visited = stats.filter((s) => s.visits);
  // Empirical terminal victory share, with visit count as a deterministic tie-break.
  const best = visited.reduce((b, s) =>
    s.total / s.visits > b.total / b.visits ||
    (s.total / s.visits === b.total / b.visits && s.visits > b.visits)
      ? s
      : b,
  );
  return {
    action: best.action,
    simulations,
    elapsedMs: performance.now() - started,
    treeNodes: trees.size,
    treeSelections,
    treeRevisits,
    candidates: stats.map((s) => ({
      action: s.action,
      visits: s.visits,
      mean: s.visits ? s.total / s.visits : null,
    })),
  };
}
