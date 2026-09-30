import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseAction as baseline } from '../src/game/ai-expert-baseline.ts';
import {
  chooseImprovedAction,
  modelAuctionOutcome,
} from '../src/game/ai-improved.ts';

test('auction model agrees with engine: sealed ties, seller payment, fixed priority and self-purchase', () => {
  for (const count of [3, 4, 5])
    for (const type of ['sealed', 'fixed'] as const)
      for (let seed = 1; seed <= 12; seed++) {
        let s = createGame(count, seed);
        const seller = s.players.find((p) =>
          p.hand.some((c) => c.type === type),
        )!.id;
        s.turn = seller;
        const c = s.players[seller].hand.find((c) => c.type === type)!;
        s = applyAction(s, { type: 'offer', player: seller, card: c.id });
        const limits = s.players.map((p) => (p.id * 7 + seed * 3) % 21);
        const me = seed % count;
        const price = seed % 3 === 0 ? limits[seller] : seed * 2;
        const expected = modelAuctionOutcome(
          type,
          seller,
          type === 'fixed' ? seller : me,
          price,
          limits,
        );
        if (type === 'fixed')
          s = applyAction(s, { type: 'price', player: seller, amount: price });
        while (s.auction) {
          const id = actor(s)!;
          s = applyAction(
            s,
            type === 'fixed'
              ? { type: 'buy', player: id, accept: limits[id] >= price }
              : {
                  type: 'bid',
                  player: id,
                  amount: id === me ? price : limits[id],
                },
          );
        }
        const trade = s.transactions.at(-1)!;
        assert.equal(trade.buyer, expected.winner);
        assert.equal(trade.amount, expected.paid);
        assertState(s);
      }
});

test('upgraded bidding ignores hidden hands, true balances, deal seed and locked bids; decisions reproducible', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  s = applyAction(s, { type: 'bid', player: 1, amount: 11 });
  const id = actor(s)!;
  const changed = structuredClone(s);
  [changed.players[3].hand[0], changed.deck[0]] = [
    changed.deck[0],
    changed.players[3].hand[0],
  ];
  changed.seed++;
  changed.players[3].cash = 9999;
  changed.auction!.bids[1] = 88;
  const o = observe(s, id),
    before = structuredClone(o);
  assert.deepEqual(
    chooseImprovedAction(o),
    chooseImprovedAction(observe(changed, id)),
  );
  assert.deepEqual(o, before);
  assertState(applyAction(s, chooseImprovedAction(o)));
});

test('upgrade keeps expert offering and public bidding, and completes legal games at all player counts', () => {
  const mechanisms = new Set<string>();
  for (const count of [3, 4, 5]) {
    let s = createGame(count, 460001 + count);
    let steps = 0;
    while (s.phase !== 'finished') {
      assert.ok(++steps < 5000);
      if (s.phase === 'roundEnd') {
        s = applyAction(s, { type: 'next' });
        continue;
      }
      const o = observe(s, actor(s)!);
      const a = chooseImprovedAction(o);
      mechanisms.add(o.auction?.type ?? 'offer');
      if (
        o.phase === 'offer' ||
        o.phase === 'pair' ||
        o.auction?.type === 'open' ||
        o.auction?.type === 'once'
      )
        assert.deepEqual(a, baseline(o));
      s = applyAction(s, a);
      assertState(s);
    }
  }
  for (const mechanism of ['sealed', 'fixed', 'open', 'once', 'double'])
    assert.ok(mechanisms.has(mechanism));
});

test('zero budget produces legal sealed bids and fixed prices', () => {
  for (const type of ['sealed', 'fixed'] as const) {
    let s = createGame(3, 1234);
    const p = s.players.find((p) => p.hand.some((c) => c.type === type))!;
    s.turn = p.id;
    s = applyAction(s, {
      type: 'offer',
      player: p.id,
      card: p.hand.find((c) => c.type === type)!.id,
    });
    const id = actor(s)!;
    s.bankFlow -= s.players[id].cash;
    s.players[id].cash = 0;
    const a = chooseImprovedAction(observe(s, id));
    assert.equal(a.type, type === 'sealed' ? 'bid' : 'price');
    assert.ok('amount' in a && a.amount === 0);
    assertState(applyAction(s, a));
  }
});

test('expert level uses auction search while the frozen old expert remains available', async () => {
  const { chooseLevelAction } = await import('../src/game/ai-levels.ts');
  const { auctionCandidates } = await import('../src/game/ai-universal.ts');
  const { makeLevelConfig } = await import('../src/game/preferences.ts');
  const { serialize, deserialize } = await import('../src/game/storage.ts');
  let s = createGame(4, 1234);
  s.aiConfig = makeLevelConfig(4, 'expert');
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const o = observe(s, actor(s)!);
  const selected = chooseLevelAction(o, 'expert');
  assert.ok(
    auctionCandidates(o).some(
      (a) => JSON.stringify(a) === JSON.stringify(selected),
    ),
  );
  assert.notDeepEqual(chooseImprovedAction(o), baseline(o));
  s = applyAction(s, selected);
  assert.deepEqual(deserialize(serialize(s)), s);
});
