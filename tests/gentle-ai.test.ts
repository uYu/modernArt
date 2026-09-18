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
import { makeAIConfig, parsePreferences } from '../src/game/preferences.ts';
import { deserialize, serialize } from '../src/game/storage.ts';

test('轻松对手在所有人数下能完成整局，保留配置且不受高级难度升级', () => {
  for (const personality of ['novice', 'relaxed'] as const)
    for (const count of [3, 4, 5]) {
      let s = createGame(count, 120003 + count);
      const config = makeAIConfig(
        count,
        { ...parsePreferences(null), personality, difficulty: 'easy' },
        0,
      );
      s.aiConfig = config;
      let steps = 0;
      while (s.phase !== 'finished') {
        assert.ok(++steps < 5000);
        if (s.phase === 'roundEnd') {
          s = applyAction(s, { type: 'next' });
          continue;
        }
        const o = observe(s, actor(s)!);
        const action = chooseConfiguredAction(o, config);
        assert.deepEqual(
          action,
          chooseConfiguredAction(o, { ...config, difficulty: 'adaptive' }),
        );
        if (action.type === 'bid' && action.amount !== null)
          assert.ok(
            action.amount <=
              Math.floor(
                o.self.cash * (personality === 'relaxed' ? 0.15 : 0.3),
              ),
          );
        s = applyAction(s, action);
        assertState(s);
      }
      assert.deepEqual(deserialize(serialize(s)), s);
    }
});

test('四档难度配置和存档往返一致，旧存档仍可识别', async () => {
  const { makeLevelConfig, configLevel } =
    await import('../src/game/preferences.ts');
  for (const level of ['beginner', 'medium', 'hard', 'expert'] as const) {
    const s = createGame(4, 42);
    s.aiConfig = makeLevelConfig(4, level);
    assert.equal(configLevel(deserialize(serialize(s)).aiConfig), level);
    assert.equal(new Set(s.aiConfig.personalities).size, 1);
  }
  assert.equal(parsePreferences(null).level, 'beginner');
  assert.equal(configLevel(), 'hard');
});
