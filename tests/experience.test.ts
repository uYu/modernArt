import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseConfiguredAction } from '../src/game/ai-configured.ts';
import { replayAt, seasonFinance } from '../src/game/experience.ts';
import { deserialize, serialize } from '../src/game/storage.ts';
import { parsePreferences, makeAIConfig } from '../src/game/preferences.ts';
import type { Difficulty } from '../src/game/preferences.ts';

test('各难度与性格完整对局合法，AI 设置随存档恢复，逐季净收益守恒', () => {
  for (const difficulty of ['easy', 'standard', 'adaptive'] as Difficulty[])
    for (const count of [3, 4, 5]) {
      let s = createGame(count, 91823 + count);
      s.aiConfig = makeAIConfig(
        count,
        { ...parsePreferences(null), personality: 'mixed', difficulty },
        count,
      );
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
      for (const p of s.players)
        assert.equal(
          100 +
            s.history.reduce(
              (n, r) => n + seasonFinance(s, r.round, p.id).net,
              0,
            ),
          p.cash,
        );
      const copy = structuredClone(s);
      const last = replayAt(s, s.actions.length);
      delete copy.aiConfig;
      assert.deepEqual(last, copy);
      assert.equal(replayAt(s, 0).actions.length, 0);
      assert.equal(s.phase, 'finished');
    }
});

test('存档拒绝非法 AI 配置，偏好损坏时恢复默认', () => {
  const save = JSON.parse(serialize(createGame()));
  save.aiConfig = { difficulty: 'god', personalities: [] };
  assert.throws(() => deserialize(JSON.stringify(save)), /AI 设置/);
  assert.equal(parsePreferences('{').speed, 850);
  assert.equal(parsePreferences('null').saleMode, 'brief');
  assert.equal(parsePreferences('{"speed":1,"hints":false}').hints, false);
});

test('自购只计买画支出、不计卖画收入，其他买家付款才计收入', () => {
  const s = createGame();
  s.transactions = [
    { round: 1, seller: 0, buyer: 0, amount: 20, cards: [] },
    { round: 1, seller: 0, buyer: 1, amount: 12, cards: [] },
  ];
  assert.deepEqual(seasonFinance(s, 1, 0), {
    sales: 12,
    purchases: 20,
    settlement: 0,
    net: -8,
  });
});

test('新策略仍只受公开观察影响，隐藏暗标与手牌不进入决策', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  const id = actor(s)!;
  const changed = structuredClone(s);
  const other = (id + 1) % 4;
  [changed.players[other].hand[0], changed.deck[0]] = [
    changed.deck[0],
    changed.players[other].hand[0],
  ];
  changed.players[other].cash = 99999;
  changed.seed = 0;
  changed.auction!.bids[other] = 999;
  const config = makeAIConfig(
    4,
    { ...parsePreferences(null), personality: 'mixed', difficulty: 'adaptive' },
    1,
  );
  assert.deepEqual(
    chooseConfiguredAction(observe(s, id), config),
    chooseConfiguredAction(observe(changed, id), config),
  );
});

test('原版稳健默认与现有 AI 决策一致', async () => {
  const { chooseAction } = await import('../src/game/ai.ts');
  let state = createGame(4, 93833);
  const config = makeAIConfig(4, parsePreferences(null), 3);
  while (state.phase !== 'finished') {
    if (state.phase === 'roundEnd') {
      state = applyAction(state, { type: 'next' });
      continue;
    }
    const o = observe(state, actor(state)!);
    const action = chooseConfiguredAction(o, config);
    assert.deepEqual(action, chooseAction(o));
    state = applyAction(state, action);
  }
});
