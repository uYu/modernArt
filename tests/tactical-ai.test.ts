import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  advanceSimulation,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { makeDeck } from '../src/game/data.ts';
import {
  nextTacticalOffer,
  searchTacticalOffer,
  tacticalContinuation,
} from '../src/game/ai-tactical.ts';
import { searchAuction } from '../src/game/ai-universal.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import {
  makeLevelConfig,
  parsePreferences,
  validAIConfig,
} from '../src/game/preferences.ts';
import { serialize, deserialize } from '../src/game/storage.ts';

test('next offering is actually re-planned, with deterministic paired scores and no hidden-state access', () => {
  const s = createGame(3, 928101);
  const o = observe(s, 0);
  const before = structuredClone(o);
  const hidden = structuredClone(s);
  [hidden.players[1].hand[0], hidden.deck[0]] = [
    hidden.deck[0],
    hidden.players[1].hand[0],
  ];
  hidden.seed++;
  hidden.players[1].cash += 1000;
  assert.deepEqual(observe(hidden, 0), o);
  const options = { samples: 2, replySamples: 1, budgetMs: 1e9 };
  const a = searchTacticalOffer(o, options);
  const b = searchTacticalOffer(observe(hidden, 0), options);
  assert.deepEqual(a.action, b.action);
  assert.deepEqual(a.candidates, b.candidates);
  assert.equal(a.completedSamples, 2);
  assert.ok(a.nextDecisionSearches > 0);
  assert.equal(
    searchTacticalOffer(o, { ...options, depth: 1 }).nextDecisionSearches,
    0,
  );
  assert.deepEqual(
    nextTacticalOffer(o, 2),
    nextTacticalOffer(observe(hidden, 0), 2),
  );
  assert.deepEqual(o, before);
  assertState(applyAction(s, a.action));
});

// Card-balanced terminal puzzle. The two legal closing artists change both
// players' portfolios: following Mo Ye loses, promoting Ji Kong wins.
function closingPuzzle() {
  const s = createGame(3, 1);
  const pool = makeDeck();
  const take = (artist: number) =>
    pool.splice(
      pool.findIndex((c) => c.artist === artist),
      1,
    )[0];
  s.round = 4;
  s.turn = 2;
  const holdings = [
    [3, 3, 4],
    [3, 1, 2, 2, 2, 2],
    [3, 4, 4, 4],
  ];
  const money = [265, 328, 247];
  s.players.forEach((p, i) => {
    p.collection = holdings[i].map(take);
    p.hand = [];
    p.cash = money[i];
  });
  s.players[2].hand = [take(2), take(4)];
  s.players[0].hand = [take(0)];
  s.players[1].hand = [take(0)];
  s.deck = pool;
  s.counts = [0, 1, 4, 4, 4];
  s.history = [
    [0, 20, 0, 30, 10],
    [0, 10, 0, 20, 30],
    [0, 0, 0, 0, 0],
  ].map((awards, i) => ({
    round: i + 1,
    awards,
    counts: [],
    values: [],
    income: money.map((cash) => (i === 0 ? cash - 100 : 0)),
    sold: [[], [], []],
    unsold: [],
    reason: 'terminal puzzle',
  }));
  s.bankFlow = money.reduce((sum, cash) => sum + cash, 0) - 300;
  assertState(s);
  return s;
}

test('real settlement: divert the market away from an opponent holding four paintings', () => {
  const s = closingPuzzle();
  const o = observe(s, 2);
  const result = searchTacticalOffer(o, {
    samples: 2,
    replySamples: 1,
    budgetMs: 1e9,
  });
  assert.equal(result.action.type, 'offer');
  if (result.action.type !== 'offer') return;
  const chosen = result.action.card;
  assert.equal(o.self.hand.find((c) => c.id === chosen)?.artist, 4);
  const closed = applyAction(s, result.action);
  assertState(closed);
  assert.deepEqual(
    closed.players.map((p) => p.cash),
    [455, 468, 517],
  );
  const follow = applyAction(s, {
    type: 'offer',
    player: 2,
    card: o.self.hand.find((c) => c.artist === 2)!.id,
  });
  assert.deepEqual(
    follow.players.map((p) => p.cash),
    [455, 518, 467],
  );
  assert.deepEqual(tacticalContinuation(o), result.action);
});

test('planning the next offering finds a winning sequence missed by greedy continuation', () => {
  // Only the root has cards left, and all money has been spent: no hidden
  // opponent choice or bidding assumption can explain the different outcome.
  const s = createGame(3, 1);
  const pool = makeDeck();
  const take = (id: string) =>
    pool.splice(
      pool.findIndex((c) => c.id === id),
      1,
    )[0];
  s.round = 4;
  s.counts = [1, 1, 1, 1, 1];
  const holdings = [['1-0'], ['3-0'], ['0-0', '2-0', '4-0']];
  s.players.forEach((p, i) => {
    p.cash = 0;
    p.hand = [];
    p.collection = holdings[i].map(take);
  });
  s.players[0].hand = ['0-3', '3-4', '4-1', '2-2'].map(take);
  s.transactions = s.players.map((p) => {
    const card = pool.shift()!;
    s.discarded.push(card);
    return { round: 1, seller: p.id, buyer: p.id, amount: 100, cards: [card] };
  });
  s.deck = pool;
  s.bankFlow = -300;
  s.history = Array.from({ length: 3 }, (_, i) => ({
    round: i + 1,
    counts: [],
    awards: [0, 0, 0, 0, 0],
    values: [],
    income: [0, 0, 0],
    sold: [[], [], []],
    unsold: [],
    reason: 'sequence puzzle',
  }));
  assertState(s);
  const finish = (replan: boolean) => {
    const state = structuredClone(s);
    advanceSimulation(state, { type: 'offer', player: 0, card: '0-3' });
    let used = false;
    while (state.phase !== 'roundEnd') {
      const view = observe(state, actor(state)!);
      const nextOffer = state.phase === 'offer' && !used;
      const action =
        replan && nextOffer
          ? nextTacticalOffer(view, 2)
          : tacticalContinuation(view);
      if (nextOffer) used = true;
      advanceSimulation(state, action);
      assertState(state);
    }
    return state.players.map((p) => p.cash);
  };
  assert.deepEqual(finish(false), [40, 10, 50]);
  assert.deepEqual(finish(true), [60, 10, 50]);
});

test('following the same artist is retained when it secures our own victory', () => {
  const s = closingPuzzle();
  s.turn = 1;
  [s.players[1].hand, s.players[2].hand] = [
    s.players[2].hand,
    s.players[1].hand,
  ];
  const o = observe(s, 1);
  const result = searchTacticalOffer(o, {
    samples: 2,
    replySamples: 1,
    budgetMs: 1e9,
  });
  assert.equal(result.action.type, 'offer');
  if (result.action.type !== 'offer') return;
  const chosen = result.action.card;
  assert.equal(o.self.hand.find((c) => c.id === chosen)?.artist, 2);
  const closed = applyAction(s, result.action);
  assertState(closed);
  assert.deepEqual(
    closed.players.map((p) => p.cash),
    [455, 518, 467],
  );
});

test('too little evidence preserves the expert; invalid budgets fail before searching', () => {
  const o = observe(createGame(3, 928101), 0);
  const r = searchTacticalOffer(o, {
    samples: 1,
    replySamples: 1,
    budgetMs: 1e9,
  });
  assert.deepEqual(r.action, r.reference);
  for (const options of [
    { samples: 0 },
    { replySamples: 0 },
    { budgetMs: 0 },
    { budgetMs: NaN },
  ])
    assert.throws(() => searchTacticalOffer(o, options));
});

test('all auction mechanisms and pairing/pass stay legal in whole games at every player count', () => {
  const mechanisms = new Set<string>();
  let pairing = 0;
  for (const count of [3, 4, 5]) {
    let s = createGame(count, 928102, 928102 % count);
    let steps = 0;
    while (s.phase !== 'finished') {
      assert.ok(++steps < 5000);
      const o = s.phase === 'roundEnd' ? null : observe(s, actor(s)!);
      if (o?.auction) mechanisms.add(o.auction.type);
      if (o?.phase === 'pair' && pairing < 3) {
        const result = searchTacticalOffer(o, {
          samples: 2,
          replySamples: 1,
          budgetMs: 1e9,
        });
        assert.ok(
          result.candidates.some(
            (c) => c.action.type === 'pair' && c.action.card === null,
          ),
        );
        for (const candidate of result.candidates)
          assertState(applyAction(s, candidate.action));
        pairing++;
      }
      s = applyAction(
        s,
        o ? tacticalContinuation(o, steps % 3) : { type: 'next' },
      );
      assertState(s);
    }
  }
  assert.equal(mechanisms.size, 5);
  assert.ok(pairing > 0);
});

test('experimental difficulty survives configuration and save/replay and uses expert auctions', () => {
  const s = createGame(3, 928101);
  s.aiConfig = makeLevelConfig(3, 'tactical');
  assert.ok(validAIConfig(s.aiConfig));
  assert.equal(
    parsePreferences(JSON.stringify({ level: 'tactical' })).level,
    'tactical',
  );
  const card = s.players[0].hand.find((c) => c.type === 'fixed')!;
  const offered = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const o = observe(offered, actor(offered)!);
  // Price/bid routing is shared; these small auctions finish all 24 samples.
  assert.deepEqual(
    chooseLevelAction(o, 'tactical'),
    chooseLevelAction(o, 'expert'),
  );
  assert.deepEqual(deserialize(serialize(offered)), offered);
});

test('full tactical searches complete every sample even when the clock exceeds old limits', (t) => {
  const s = createGame(3, 928101);
  const o = observe(s, 0);
  const offer = searchTacticalOffer(o, { budgetMs: Infinity });
  assert.equal(offer.completedSamples, 8);
  const card = s.players[0].hand.find((c) => c.type === 'fixed')!;
  const auctionState = applyAction(s, {
    type: 'offer',
    player: 0,
    card: card.id,
  });
  const auctionView = observe(auctionState, actor(auctionState)!);
  const auction = searchAuction(auctionView, { budgetMs: Infinity });
  assert.ok(auction.candidates.length > 1);
  assert.equal(auction.completedSamples, 24);
  let clock = 0;
  t.mock.method(performance, 'now', () => (clock += 20000));
  const slowOffer = searchTacticalOffer(o, { budgetMs: Infinity });
  const slowAuction = searchAuction(auctionView, { budgetMs: Infinity });
  assert.equal(slowOffer.completedSamples, 8);
  assert.equal(slowAuction.completedSamples, 24);
  assert.deepEqual(slowOffer.candidates, offer.candidates);
  assert.deepEqual(slowAuction.candidates, auction.candidates);
  assert.deepEqual(chooseLevelAction(o, 'tactical'), offer.action);
  assert.deepEqual(chooseLevelAction(auctionView, 'tactical'), auction.action);
});
