import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import {
  auctionCandidates,
  chooseUniversalAction,
  searchAuction,
} from '../src/game/ai-universal.ts';

test('universal auction actions remain legal through real 3/4/5 player games', () => {
  const phases = new Set<string>();
  for (const count of [3, 4, 5]) {
    let s = createGame(count, 550000 + count);
    while (s.phase !== 'finished') {
      if (s.phase === 'roundEnd') {
        s = applyAction(s, { type: 'next' });
        continue;
      }
      const o = observe(s, actor(s)!);
      const key = `${o.phase}/${o.auction?.type ?? 'offer'}`;
      if (!phases.has(key))
        for (const action of auctionCandidates(o))
          assertState(applyAction(s, action));
      phases.add(key);
      s = applyAction(s, chooseImprovedAction(o));
    }
  }
  for (const phase of [
    'price/fixed',
    'bid/sealed',
    'bid/fixed',
    'bid/open',
    'bid/once',
    'pair/double',
  ])
    assert.ok(phases.has(phase), phase);
});

test('search only sees observations and is reproducible with fixed sample count', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  s = applyAction(s, { type: 'bid', player: actor(s)!, amount: 11 });
  const id = actor(s)!;
  const changed = structuredClone(s);
  [changed.players[3].hand[0], changed.deck[0]] = [
    changed.deck[0],
    changed.players[3].hand[0],
  ];
  changed.players[3].cash = 9999;
  changed.seed++;
  changed.auction!.bids[1] = 88;
  const before = observe(s, id),
    a = searchAuction(before, { samples: 8, budgetMs: 10000 });
  const b = searchAuction(observe(changed, id), {
    samples: 8,
    budgetMs: 10000,
  });
  assert.deepEqual({ ...a, elapsedMs: 0 }, { ...b, elapsedMs: 0 });
  assertState(applyAction(s, a.action));
});

test('universal choice can fall back to tested expert under insufficient evidence', () => {
  let s = createGame(3, 1234);
  const p = s.players.find((p) => p.hand.some((c) => c.type === 'fixed'))!;
  s.turn = p.id;
  s = applyAction(s, {
    type: 'offer',
    player: p.id,
    card: p.hand.find((c) => c.type === 'fixed')!.id,
  });
  const o = observe(s, actor(s)!);
  const result = searchAuction(o, { samples: 1, budgetMs: 10000 });
  assert.deepEqual(result.reference, chooseImprovedAction(o));
  assert.ok(
    auctionCandidates(o).some(
      (a) => JSON.stringify(a) === JSON.stringify(result.action),
    ),
  );
  assertState(applyAction(s, chooseUniversalAction(o)));
});

test('fixed-price search never considers accepting an unaffordable lot', () => {
  let s = createGame(3, 550123);
  const p = s.players.find((p) => p.hand.some((c) => c.type === 'fixed'))!;
  s.turn = p.id;
  s = applyAction(s, {
    type: 'offer',
    player: p.id,
    card: p.hand.find((c) => c.type === 'fixed')!.id,
  });
  s = applyAction(s, { type: 'price', player: p.id, amount: 50 });
  const id = actor(s)!;
  s.bankFlow -= s.players[id].cash - 10;
  s.players[id].cash = 10;
  const o = observe(s, id);
  assert.deepEqual(auctionCandidates(o), [
    { type: 'buy', player: id, accept: false },
  ]);
  const result = searchAuction(o);
  assert.deepEqual(result.action, { type: 'buy', player: id, accept: false });
  assertState(applyAction(s, result.action));
});

test('the expert level routes auction decisions through the new search', () => {
  let s = createGame(3, 550123);
  const offerer = actor(s)!;
  const offer = chooseLevelAction(observe(s, offerer), 'expert');
  assert.deepEqual(offer, chooseImprovedAction(observe(s, offerer)));
  s = applyAction(s, offer);
  if (s.phase === 'pair') {
    const pair = chooseLevelAction(observe(s, actor(s)!), 'expert');
    s = applyAction(s, pair);
  }
  const id = actor(s)!;
  const action = chooseLevelAction(observe(s, id), 'expert');
  assertState(applyAction(s, action));
});

test('experimental final-round evaluator settles sampled games without private inputs', () => {
  let s = createGame(3, 810010);
  while (
    s.phase !== 'finished' &&
    !(
      s.round === 4 &&
      s.phase !== 'offer' &&
      s.phase !== 'pair' &&
      Math.max(...s.counts) >= 4
    )
  ) {
    if (s.phase === 'roundEnd') {
      s = applyAction(s, { type: 'next' });
      continue;
    }
    s = applyAction(s, chooseImprovedAction(observe(s, actor(s)!)));
  }
  assert.notEqual(s.phase, 'finished');
  const o = observe(s, actor(s)!);
  const result = searchAuction(o, {
    evaluation: 'final-round',
    samples: 3,
    budgetMs: 10000,
  });
  assert.equal(result.completedSamples, 3);
  assert.ok(result.candidates.every((c) => Number.isFinite(c.mean)));
  assertState(applyAction(s, result.action));
  const changed = structuredClone(s);
  changed.seed++;
  changed.players[(o.self.id + 1) % 3].cash = 9999;
  const again = searchAuction(observe(changed, actor(changed)!), {
    evaluation: 'final-round',
    samples: 3,
    budgetMs: 10000,
  });
  assert.deepEqual(result.action, again.action);
  assert.deepEqual(result.candidates, again.candidates);
  const weighted = searchAuction(o, {
    evaluation: 'final-round',
    belief: 'weighted',
    samples: 3,
    budgetMs: 10000,
  });
  assert.equal(weighted.completedSamples, 3);
  assertState(applyAction(s, weighted.action));
  const weightedAgain = searchAuction(observe(changed, actor(changed)!), {
    evaluation: 'final-round',
    belief: 'weighted',
    samples: 3,
    budgetMs: 10000,
  });
  assert.deepEqual(weighted.action, weightedAgain.action);
  assert.deepEqual(weighted.candidates, weightedAgain.candidates);
  const winObjective = searchAuction(o, {
    evaluation: 'final-win',
    samples: 3,
    budgetMs: 10000,
  });
  assert.equal(winObjective.completedSamples, 3);
  assert.ok(winObjective.candidates.every((c) => c.mean >= 0 && c.mean <= 1));
  assertState(applyAction(s, winObjective.action));
  const anchored = searchAuction(o, {
    evaluation: 'final-win',
    reference: result.action,
    samples: 3,
    budgetMs: 10000,
  });
  assert.deepEqual(anchored.reference, result.action);
  assert.ok(
    anchored.candidates.some(
      (candidate) =>
        JSON.stringify(candidate.action) === JSON.stringify(result.action),
    ),
  );
  assertState(applyAction(s, anchored.action));
});
