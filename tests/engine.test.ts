import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  currentValues,
  observe,
  ranking,
} from '../src/game/engine.ts';
import { makeDeck, DEALS, DISTRIBUTION } from '../src/game/data.ts';
import { chooseAction } from '../src/game/ai.ts';
import { deserialize, serialize } from '../src/game/storage.ts';
import type { AuctionType, GameState } from '../src/game/types.ts';
function rig(type: AuctionType, artist = 0): GameState {
  const s = createGame(3, 123);
  const all = makeDeck(),
    c = all.find((c) => c.type === type && c.artist === artist)!;
  const filler = all.find((c) => c.artist === 4)!;
  s.players.forEach((p) => {
    p.hand = [];
    p.collection = [];
  });
  s.players[0].hand = [c];
  s.players[2].hand = [filler];
  s.deck = all.filter((x) => x.id !== c.id && x.id !== filler.id);
  return s;
}
function give(s: GameState, p: number, type: AuctionType, artist = 0) {
  const i = s.deck.findIndex((c) => c.type === type && c.artist === artist);
  assert.ok(i >= 0);
  const c = s.deck.splice(i, 1)[0];
  s.players[p].hand.push(c);
  return c;
}
function own(s: GameState, p: number, artist: number, n: number) {
  for (let i = 0; i < n; i++) {
    const j = s.deck.findIndex((c) => c.artist === artist);
    assert.ok(j >= 0);
    s.players[p].collection.push(s.deck.splice(j, 1)[0]);
    s.counts[artist]++;
  }
}
function offer(s: GameState) {
  return applyAction(s, {
    type: 'offer',
    player: 0,
    card: s.players[0].hand[0].id,
  });
}
function bid(s: GameState, n: number | null) {
  return applyAction(s, { type: 'bid', player: actor(s)!, amount: n });
}
test('牌组组成、人数发牌、固定种子与合法先手', () => {
  assert.equal(makeDeck().length, 70);
  assert.deepEqual(
    DISTRIBUTION.map((r) => r.reduce((a, b) => a + b)),
    [12, 13, 14, 15, 16],
  );
  for (const n of [3, 4, 5]) {
    const s = createGame(n, 12, n - 1);
    assert.equal(actor(s), n - 1);
    assertState(s);
    assert.ok(s.players.every((p) => p.hand.length === DEALS[n][0]));
    assert.deepEqual(s, createGame(n, 12, n - 1));
  }
  assert.throws(() => createGame(2));
  assert.throws(() => createGame(4, 1, 4));
});
test('一次出价：拍卖师最后，买家付款给拍卖师', () => {
  let s = offer(rig('once'));
  assert.equal(actor(s), 1);
  s = bid(s, 12);
  s = bid(s, 18);
  s = bid(s, null);
  assert.equal(s.players[0].cash, 118);
  assert.equal(s.players[2].cash, 82);
  assert.equal(s.players[2].collection.length, 1);
  assertState(s);
});
test('拍卖师自购付款到银行，无人报价则免费获得', () => {
  let s = offer(rig('once'));
  s = bid(s, 12);
  s = bid(s, null);
  s = bid(s, 13);
  assert.equal(s.players[0].cash, 87);
  assert.equal(s.bankFlow, -13);
  assertState(s);
  s = offer(rig('once'));
  s = bid(s, null);
  s = bid(s, null);
  s = bid(s, null);
  assert.equal(s.players[0].cash, 100);
  assert.equal(s.players[0].collection.length, 1);
});
test('公开竞价：暂不加价可重新参与，完整一圈无人加价才成交', () => {
  let s = offer(rig('open'));
  s = bid(s, null);
  s = bid(s, 5);
  s = bid(s, null);
  assert.equal(actor(s), 1);
  s = bid(s, 6);
  assert.equal(actor(s), 2);
  s = bid(s, null);
  s = bid(s, null);
  assert.equal(s.phase, 'offer');
  assert.equal(s.players[1].collection.length, 1);
  assertState(s);
});
test('出价必须为正向加价整数，不可透支；错误动作不修改原状态', () => {
  const s = offer(rig('open')),
    before = structuredClone(s);
  for (const n of [-1, 0, 101, 1.5, NaN, Infinity])
    assert.throws(() => bid(s, n));
  assert.throws(() => applyAction(s, { type: 'bid', player: 0, amount: 5 }));
  assert.deepEqual(s, before);
  let x = bid(s, 10);
  assert.throws(() => bid(x, 10));
});
test('暗标：拍卖师平价优先，其他平价按顺时针；0 元允许', () => {
  let s = offer(rig('sealed'));
  s = bid(s, 15);
  s = bid(s, 15);
  assert.ok(!s.log.some((l) => l.includes('15')));
  const o = observe(s, 0);
  assert.ok(!('bids' in o.auction!));
  assert.equal(o.transactions.length, 0);
  s = bid(s, 15);
  assert.equal(s.players[0].collection.length, 1);
  assertState(s);
  s = offer(rig('sealed'));
  s = bid(s, 15);
  s = bid(s, 15);
  s = bid(s, 0);
  assert.equal(s.players[1].collection.length, 1);
  s = offer(rig('sealed'));
  s = bid(s, 0);
  s = bid(s, 0);
  s = bid(s, 0);
  assert.equal(s.players[0].cash, 100);
  assert.equal(s.players[0].collection.length, 1);
});
test('一口价：按正确座次询问，接受立即成交', () => {
  let s = rig('fixed');
  s.turn = 2;
  const c = give(s, 2, 'fixed', 1);
  s = applyAction(s, { type: 'offer', player: 2, card: c.id });
  s = applyAction(s, { type: 'price', player: 2, amount: 23 });
  assert.equal(actor(s), 0);
  s = applyAction(s, { type: 'buy', player: 0, accept: false });
  assert.equal(actor(s), 1);
  s = applyAction(s, { type: 'buy', player: 1, accept: true });
  assert.equal(s.players[2].cash, 123);
  assert.equal(s.players[1].cash, 77);
  assertState(s);
});
test('一口价不能超过拍卖师现金，无人接受时强制自购', () => {
  let s = offer(rig('fixed'));
  assert.throws(() =>
    applyAction(s, { type: 'price', player: 0, amount: 101 }),
  );
  s = applyAction(s, { type: 'price', player: 0, amount: 31 });
  s = applyAction(s, { type: 'buy', player: 1, accept: false });
  s = applyAction(s, { type: 'buy', player: 2, accept: false });
  assert.equal(s.players[0].cash, 69);
  assert.equal(s.bankFlow, -31);
  assertState(s);
});
test('双重拍卖自己补画，按第二张类型拍卖两张', () => {
  let s = rig('double');
  const c = give(s, 0, 'once');
  s = offer(s);
  s = applyAction(s, { type: 'pair', player: 0, card: c.id });
  assert.equal(s.auction!.type, 'once');
  assert.equal(s.counts[0], 2);
  s = bid(s, 20);
  s = bid(s, null);
  s = bid(s, null);
  assert.equal(s.players[1].collection.length, 2);
  assertState(s);
});
test('双重拍卖他人接任收取全部款项，并从接任者之后继续', () => {
  let s = rig('double');
  const c = give(s, 1, 'once');
  give(s, 0, 'open', 1);
  s = offer(s);
  s = applyAction(s, { type: 'pair', player: 0, card: null });
  s = applyAction(s, { type: 'pair', player: 1, card: c.id });
  s = bid(s, 20);
  s = bid(s, null);
  s = bid(s, null);
  assert.equal(s.players[1].cash, 120);
  assert.equal(s.players[0].cash, 100);
  assert.equal(s.turn, 2);
  assertState(s);
});
test('双重拍卖无人补画归原拍卖师，不能补双重或不同艺术家', () => {
  let s = rig('double');
  const bad = give(s, 0, 'double'),
    other = give(s, 0, 'open', 1);
  s = offer(s);
  assert.throws(() =>
    applyAction(s, { type: 'pair', player: 0, card: bad.id }),
  );
  assert.throws(() =>
    applyAction(s, { type: 'pair', player: 0, card: other.id }),
  );
  for (let p = 0; p < 3; p++)
    s = applyAction(s, { type: 'pair', player: p, card: null });
  assert.equal(s.players[0].collection.length, 1);
  assertState(s);
});
test('第五张画不成交但计入排名，手牌保留，藏品出售清空', () => {
  let s = rig('open');
  own(s, 1, 0, 4);
  const extra = give(s, 0, 'open', 1);
  s = offer(s);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.history[0].counts[0], 5);
  assert.equal(s.history[0].income[1], 120);
  assert.equal(s.players[1].cash, 220);
  assert.equal(s.players[0].hand[0].id, extra.id);
  assert.equal(s.players[1].collection.length, 0);
  assertState(s);
  s = applyAction(s, { type: 'next' });
  assert.equal(s.round, 2);
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].hand.length, 7);
  assertState(s);
});
test('双重的第二张触发第五张，两张都不售出', () => {
  let s = rig('double');
  own(s, 2, 0, 3);
  const c = give(s, 1, 'once');
  s = offer(s);
  s = applyAction(s, { type: 'pair', player: 0, card: null });
  s = applyAction(s, { type: 'pair', player: 1, card: c.id });
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.history[0].income[2], 90);
  assert.equal(s.history[0].unsold.length, 2);
  assert.equal(s.transactions.length, 0);
  assert.equal(s.discarded.length, 5);
  assert.equal(s.turn, 2);
  assertState(s);
});
test('双重的第一张触发第五张，不进入补画', () => {
  let s = rig('double');
  own(s, 2, 0, 4);
  s = offer(s);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.history[0].income[2], 120);
  assertState(s);
});
test('同数量按艺术家顺序排名，未出现者不入榜，跌出前三历史价格无效', () => {
  assert.deepEqual(ranking([2, 2, 2, 2, 0]), [0, 1, 2]);
  assert.deepEqual(ranking([0, 0, 1, 0, 0]), [2]);
  const s = createGame();
  s.counts = [1, 4, 3, 2, 0];
  s.history = [
    {
      round: 1,
      counts: [5, 0, 0, 0, 0],
      awards: [30, 0, 0, 0, 0],
      values: [30, 0, 0, 0, 0],
      income: [0, 0, 0, 0],
      sold: [[], [], [], []],
      unsold: [],
      reason: '',
    },
  ];
  assert.deepEqual(currentValues(s), [0, 30, 20, 10, 0]);
  s.counts = [5, 4, 3, 2, 0];
  assert.deepEqual(currentValues(s), [60, 20, 10, 0, 0]);
});
test('所有手牌耗尽时，最后一张不成交，结算后结束游戏', () => {
  let s = rig('open');
  s.deck.push(...s.players[2].hand);
  s.players[2].hand = [];
  s = offer(s);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.history[0].sold.flat().length, 0);
  s = applyAction(s, { type: 'next' });
  assert.equal(s.phase, 'finished');
  assertState(s);
});
test('第四季后结束；空手玩家跳过出画但能竞价', () => {
  let s = rig('once');
  s = offer(s);
  assert.equal(actor(s), 1);
  s = bid(s, 5);
  s = bid(s, null);
  s = bid(s, null);
  assert.equal(s.turn, 2);
  s = rig('open');
  s.round = 4;
  own(s, 1, 0, 4);
  s = offer(s);
  s = applyAction(s, { type: 'next' });
  assert.equal(s.phase, 'finished');
  assert.throws(() => applyAction(s, { type: 'next' }));
});
test('AI 可见信息隔离：改变对手手牌、现金、暗标和牌堆不影响决策', () => {
  let s = offer(rig('sealed'));
  s = bid(s, 17);
  const id = actor(s)!;
  const before = observe(s, id),
    altered = structuredClone(s);
  altered.seed++;
  altered.deck.reverse();
  altered.players[0].cash = 987;
  altered.players[0].hand.reverse();
  altered.auction!.bids[1] = 83;
  assert.deepEqual(observe(altered, id), before);
  assert.deepEqual(chooseAction(observe(altered, id)), chooseAction(before));
});
test('90 局 AI 自对战：3/4/5 人逐步检查卡牌、现金与有限终止，存档重放一致', () => {
  const coverage = new Set<string>();
  for (const count of [3, 4, 5])
    for (let seed = 1; seed <= 30; seed++) {
      let s = createGame(count, seed, seed % count),
        steps = 0;
      while (s.phase !== 'finished') {
        assertState(s);
        if (s.auction) coverage.add(s.auction.type);
        if (s.phase === 'roundEnd') s = applyAction(s, { type: 'next' });
        else s = applyAction(s, chooseAction(observe(s, actor(s)!)));
        assert.ok(++steps < 2500, '对局未能终止');
      }
      assertState(s);
      assert.equal(s.history.length, 4);
      assert.deepEqual(deserialize(serialize(s)), s);
    }
  assert.deepEqual([...coverage].sort(), [
    'double',
    'fixed',
    'once',
    'open',
    'sealed',
  ]);
});
test('损坏、篡改、未知版本存档被拒绝', () => {
  assert.throws(() => deserialize('{}'));
  assert.throws(() => deserialize('{"version":1,"actions":[]}'));
  assert.throws(() => deserialize('{'));
  const s = createGame(3, 1);
  const d = JSON.parse(serialize(s));
  d.actions = [{ type: 'bid', player: 0, amount: 999 }];
  assert.throws(() => deserialize(JSON.stringify(d)));
});
