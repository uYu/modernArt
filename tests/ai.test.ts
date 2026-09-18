import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction, publicCash } from '../src/game/ai.ts';
import { chooseAction as legacy } from '../src/game/ai-legacy.ts';
import { actor, applyAction, createGame, observe } from '../src/game/engine.ts';
import { makeDeck } from '../src/game/data.ts';

test('公开记账逐步吻合真实资金，包括自购、转账和四季结算', () => {
  for (const count of [3, 4, 5]) {
    let s = createGame(count, 710 + count);
    while (s.phase !== 'finished') {
      assert.deepEqual(
        publicCash(observe(s, 0)),
        s.players.map((p) => p.cash),
      );
      s = applyAction(
        s,
        s.phase === 'roundEnd'
          ? { type: 'next' }
          : legacy(observe(s, actor(s)!)),
      );
    }
    assert.deepEqual(
      publicCash(observe(s, 0)),
      s.players.map((p) => p.cash),
    );
  }
});
test('AI 信息隔离：换掉未知牌和余额、种子、未揭晓暗标仍产生同一决定', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed');
  assert.ok(card);
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const id = actor(s)!;
  const before = observe(s, id),
    altered = structuredClone(s);
  const other = (id + 1) % 4;
  [altered.players[other].hand[0], altered.deck[0]] = [
    altered.deck[0],
    altered.players[other].hand[0],
  ];
  altered.seed += 77;
  altered.players[other].cash = 900;
  altered.auction!.bids[other] = 123;
  assert.deepEqual(observe(altered, id), before);
  assert.deepEqual(chooseAction(before), chooseAction(observe(altered, id)));
});
test('末季可通过第五张确定单独获胜时立即结束', () => {
  const o = observe(createGame(3, 8), 0);
  const deck = makeDeck();
  o.round = 4;
  o.counts = [4, 1, 0, 0, 0];
  o.self.cash = 1000;
  const end = deck.find((c) => c.artist === 0 && c.type !== 'double')!;
  o.self.hand = [deck.find((c) => c.artist === 1)!, end];
  o.players[0].handCount = 2;
  assert.deepEqual(chooseAction(o), { type: 'offer', player: 0, card: end.id });
});
test('秘密竞价与一口价在现金为0时仍给出合法动作', () => {
  for (const type of ['sealed', 'fixed'] as const) {
    const o = observe(createGame(3, 8), 0);
    o.phase = type === 'fixed' ? 'price' : 'bid';
    o.self.cash = 0;
    o.auction = {
      seller: 0,
      cards: [makeDeck().find((c) => c.type === type)!],
      type,
      queue: [0],
      price: null,
      high: 0,
      bidder: null,
    };
    assert.deepEqual(chooseAction(o), {
      type: type === 'fixed' ? 'price' : 'bid',
      player: 0,
      amount: 0,
    });
  }
});

test('卖家最后一次出价会计算放弃卖画收入的机会成本', () => {
  const o = observe(createGame(3, 8), 0);
  o.round = 2;
  o.phase = 'bid';
  o.counts = [4, 3, 2, 1, 0];
  o.awards = [[30, 20, 10, 0, 0]];
  o.self.hand = [];
  o.auction = {
    seller: 0,
    cards: [makeDeck().find((c) => c.artist === 0 && c.type === 'once')!],
    type: 'once',
    queue: [0],
    price: null,
    high: 37,
    bidder: 1,
  };
  assert.deepEqual(legacy(o), { type: 'bid', player: 0, amount: 38 });
  assert.deepEqual(chooseAction(o), { type: 'bid', player: 0, amount: null });
});
test('公开竞价远离估值时跳价、接近上限时小步加价且不透支', () => {
  const o = observe(createGame(3, 8), 0);
  o.round = 3;
  o.phase = 'bid';
  o.counts = [4, 3, 2, 1, 0];
  o.awards = [
    [30, 20, 10, 0, 0],
    [30, 20, 10, 0, 0],
  ];
  o.auction = {
    seller: 1,
    cards: [makeDeck().find((c) => c.artist === 0 && c.type === 'open')!],
    type: 'open',
    queue: [0, 1],
    price: null,
    high: 10,
    bidder: 2,
  };
  assert.deepEqual(chooseAction(o), { type: 'bid', player: 0, amount: 20 });
  o.self.cash = 12;
  assert.deepEqual(chooseAction(o), { type: 'bid', player: 0, amount: 11 });
  o.self.cash = 10;
  assert.deepEqual(chooseAction(o), { type: 'bid', player: 0, amount: null });
});
