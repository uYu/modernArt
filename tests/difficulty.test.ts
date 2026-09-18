import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  createGame,
  observe,
  assertState,
} from '../src/game/engine.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import { chooseConfiguredAction } from '../src/game/ai-configured.ts';
import { makeLevelConfig } from '../src/game/preferences.ts';
import type { GameLevel } from '../src/game/preferences.ts';
import { deserialize, serialize } from '../src/game/storage.ts';
const levels: GameLevel[] = ['beginner', 'medium', 'hard', 'expert'];
test('入门会正常竞买有价值的作品，不再受低现金比例上限约束', () => {
  const o = observe(createGame(3, 5), 1);
  o.phase = 'bid';
  o.self.cash = 100;
  o.self.hand = [];
  o.counts = [4, 2, 1, 0, 0];
  o.awards = [[30, 20, 10, 0, 0]];
  o.auction = {
    seller: 0,
    cards: [{ id: '0-1', artist: 0, type: 'fixed', index: 1 }],
    type: 'fixed',
    high: 0,
    bidder: null,
    price: 35,
    queue: [1, 2],
  };
  assert.deepEqual(chooseLevelAction(o, 'beginner'), {
    type: 'buy',
    player: 1,
    accept: true,
  });
  o.phase = 'price';
  const price = chooseLevelAction(o, 'beginner');
  assert.equal(price.type, 'price');
  if (price.type === 'price')
    assert.ok(price.amount >= 30 && price.amount <= 50);
  o.phase = 'bid';
  o.auction.type = 'open';
  o.auction.high = 30;
  const bid = chooseLevelAction(o, 'beginner');
  assert.equal(bid.type, 'bid');
  if (bid.type === 'bid') assert.ok(bid.amount !== null && bid.amount > 30);
});
test('四档完整对战保持资金卡牌守恒，存档重放一致', () => {
  for (const level of levels)
    for (const count of [3, 4, 5]) {
      let s = createGame(count, 140003 + count);
      s.aiConfig = makeLevelConfig(count, level);
      let steps = 0;
      while (s.phase !== 'finished') {
        assert.ok(++steps < 5000);
        s = applyAction(
          s,
          s.phase === 'roundEnd'
            ? { type: 'next' }
            : chooseConfiguredAction(observe(s, actor(s)!), s.aiConfig),
        );
        assertState(s);
      }
      assert.deepEqual(deserialize(serialize(s)), s);
    }
});
test('难度策略不读取未公开的手牌、现金、种子和暗标', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const id = actor(s)!,
    other = (id + 1) % 4,
    changed = structuredClone(s);
  [changed.players[other].hand[0], changed.deck[0]] = [
    changed.deck[0],
    changed.players[other].hand[0],
  ];
  changed.seed = 1;
  changed.players[other].cash = 9999;
  changed.auction!.bids[other] = 99;
  for (const level of levels)
    assert.deepEqual(
      chooseLevelAction(observe(s, id), level),
      chooseLevelAction(observe(changed, id), level),
    );
});

test('入门判断误差包含高估与低估，报价不是统一打折', () => {
  const o = observe(createGame(3, 7), 1);
  o.phase = 'price';
  o.self.hand = [];
  o.self.cash = 100;
  o.counts = [4, 2, 1, 0, 0];
  o.awards = [[30, 20, 10, 0, 0]];
  let higher = false,
    lower = false;
  for (let i = 0; i < 12; i++) {
    o.auction = {
      seller: 1,
      cards: [{ id: `0-${i}`, artist: 0, type: 'fixed', index: i }],
      type: 'fixed',
      high: 0,
      bidder: null,
      price: null,
      queue: [1],
    };
    const a = chooseLevelAction(o, 'beginner'),
      b = chooseLevelAction(o, 'medium');
    if (a.type === 'price' && b.type === 'price') {
      higher ||= a.amount > b.amount;
      lower ||= a.amount < b.amount;
    }
  }
  assert.ok(higher && lower);
  o.self.cash = 0;
  for (const level of levels)
    assert.deepEqual(chooseLevelAction(o, level), {
      type: 'price',
      player: 1,
      amount: 0,
    });
});
