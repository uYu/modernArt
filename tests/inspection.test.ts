import test from 'node:test';
import assert from 'node:assert/strict';
import { actor, applyAction, createGame, observe } from '../src/game/engine.ts';
import { chooseAction } from '../src/game/ai-legacy.ts';
import { inspectGame, AUCTION_TYPES } from '../src/game/inspection.ts';
import { DISTRIBUTION } from '../src/game/data.ts';

test('剩余牌仅按公开亮相记录扣除，排除当前拍品且不改状态', () => {
  let s = createGame(4, 92);
  const initial = structuredClone(s);
  const result = inspectGame(s, 1);
  assert.deepEqual(
    result.counts.map((row) => row.map((c) => c.remaining)),
    DISTRIBUTION,
  );
  assert.equal(
    result.counts.flat().reduce((sum, c) => sum + c.remaining, 0),
    70,
  );
  assert.deepEqual(s, initial);
  const card = s.players[0].hand[0];
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const current = inspectGame(s, 1);
  assert.equal(
    current.counts.flat().reduce((sum, c) => sum + c.remaining, 0),
    69,
  );
  assert.equal(
    current.counts[card.artist][AUCTION_TYPES.indexOf(card.type)].remaining,
    DISTRIBUTION[card.artist][AUCTION_TYPES.indexOf(card.type)] - 1,
  );
  assert.ok(current.players.every((p) => p.bought.length === 0));
  assert.deepEqual(current.seasonSales, [[0, 0, 0, 0, 0], null, null, null]);
});

test('结算后及下一季仍能按玩家查看往季购买，不混入未成交的终季牌', () => {
  let s = createGame(3, 71);
  while (s.phase !== 'roundEnd')
    s = applyAction(s, chooseAction(observe(s, actor(s)!)));
  const bought = s.history[0].sold;
  const summary = inspectGame(s, 1);
  assert.deepEqual(
    summary.seasonSales[0]!.map((n, a) => n + summary.seasonUnsold[0]![a]),
    s.history[0].counts,
  );
  assert.ok(summary.seasonUnsold[0]!.some((n) => n > 0));
  const soldCounts = Array.from(
    { length: 5 },
    (_, a) => bought.flat().filter((c) => c.artist === a).length,
  );
  assert.deepEqual(inspectGame(s, 1).seasonSales, [
    soldCounts,
    null,
    null,
    null,
  ]);
  assert.ok(
    soldCounts.reduce((sum, n) => sum + n, 0) <
      s.history[0].counts.reduce((sum, n) => sum + n, 0),
  );
  assert.deepEqual(
    inspectGame(s, 1).players.map((p) => p.bought),
    bought,
  );
  assert.deepEqual(
    inspectGame(s, 1).players.map((p) => p.settlement),
    s.history[0].income,
  );
  s = applyAction(s, { type: 'next' });
  assert.deepEqual(inspectGame(s, 2).seasonSales, [
    soldCounts,
    [0, 0, 0, 0, 0],
    null,
    null,
  ]);
  assert.deepEqual(
    inspectGame(s, 1).players.map((p) => p.bought),
    bought,
  );
  assert.ok(inspectGame(s, 2).players.every((p) => p.bought.length === 0));
  const old = inspectGame(s, 1);
  assert.deepEqual(
    old.players.map((p) => p.cash),
    s.players.map((p) => p.cash),
  );
  const remaining = old.counts.flat().reduce((sum, c) => sum + c.remaining, 0);
  assert.equal(remaining + s.discarded.length, 70);
});

test('隐藏手牌、牌堆、真实余额和秘密报价的变化不会影响公开记牌面板', () => {
  let s = createGame(4, 92);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const expected = inspectGame(s, 1);
  const hidden = structuredClone(s);
  [hidden.players[1].hand, hidden.deck] = [hidden.deck, hidden.players[1].hand];
  hidden.players.forEach((p) => {
    p.cash = 999;
  });
  hidden.auction!.bids = { 1: 78, 2: 91 };
  assert.deepEqual(inspectGame(hidden, 1), expected);
  assert.ok(
    expected.counts.flat().every((c) => !('inHands' in c) && !('undealt' in c)),
  );
});

test('整局每一步按公开流水推算的现金都与实际余额一致', () => {
  for (const seed of [71, 92, 123]) {
    let s = createGame(4, seed);
    while (s.phase !== 'finished') {
      s = applyAction(
        s,
        s.phase === 'roundEnd'
          ? { type: 'next' }
          : chooseAction(observe(s, actor(s)!)),
      );
      assert.deepEqual(
        inspectGame(s, s.round).players.map((p) => p.cash),
        s.players.map((p) => p.cash),
      );
    }
  }
});

test('交易明细和现金不受日志文案影响，旧版行动存档重放恢复公开记录', async () => {
  const { seasonDetails } = await import('../src/game/inspection.ts');
  const { serialize, deserialize } = await import('../src/game/storage.ts');
  let s = createGame(4, 71);
  while (s.phase !== 'roundEnd')
    s = applyAction(s, chooseAction(observe(s, actor(s)!)));
  const replay = deserialize(serialize(s));
  assert.deepEqual(replay.transactions, s.transactions);
  assert.deepEqual(replay.history[0].unsold, s.history[0].unsold);
  const expected = inspectGame(s, 1);
  s.log = ['文案已完全替换'];
  assert.deepEqual(inspectGame(s, 1), expected);
  for (let a = 0; a < 5; a++) {
    const details = seasonDetails(s, 1, a);
    assert.equal(details.length, s.history[0].counts[a]);
    assert.equal(
      details.filter((d) => d.unsold).length,
      expected.seasonUnsold[0]![a],
    );
    for (const d of details.filter((d) => !d.unsold)) {
      const tx = s.transactions.find((t) =>
        t.cards.some((c) => c.id === d.card.id),
      )!;
      assert.equal(d.amount, tx.amount);
      assert.equal(d.bundle, tx.cards.length);
      assert.equal(d.buyer, s.players[tx.buyer].name);
    }
  }
});
