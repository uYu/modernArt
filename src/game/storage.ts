import { validAIConfig } from './preferences.ts';
import { applyAction, assertState, createGame } from './engine.ts';
import type { Action, GameState } from './types.ts';
export const SAVE_KEY = 'modern-art.session.v1';
export function serialize(s: GameState) {
  return JSON.stringify({
    version: 1,
    ...(s.aiConfig ? { aiConfig: s.aiConfig } : {}),
    seed: s.seed,
    first: s.first,
    count: s.players.length,
    actions: s.actions,
  });
}
export function deserialize(raw: string): GameState {
  if (raw.length > 2_000_000) throw new Error('存档过大');
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 1 ||
    ![3, 4, 5].includes(data.count) ||
    !Number.isInteger(data.seed) ||
    !Number.isInteger(data.first) ||
    !Array.isArray(data.actions) ||
    data.actions.length > 10000
  )
    throw new Error('不支持的存档格式');
  let s = createGame(data.count, data.seed, data.first);
  for (const action of data.actions as Action[]) {
    if (!action || typeof action !== 'object') throw new Error('存档行动无效');
    s = applyAction(s, action);
  }
  if (data.aiConfig !== undefined) {
    if (
      !validAIConfig(data.aiConfig) ||
      data.aiConfig.personalities.length !== data.count
    )
      throw new Error('AI 设置无效');
    s.aiConfig = data.aiConfig;
  }
  assertState(s);
  return s;
}
