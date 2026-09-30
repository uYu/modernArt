import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseAction } from '../src/game/ai-legacy.ts';
import {
  candidateActions,
  plan,
  sampleWorld,
} from '../src/game/ai-planning.ts';

test('sampled worlds preserve cards, balances, observations and legal candidates throughout real games', () => {
  const phases = new Set<string>();
  for (const count of [3, 4, 5]) {
    let s = createGame(count, 310000 + count);
    while (s.phase !== 'finished') {
      if (s.phase === 'roundEnd') {
        s = applyAction(s, { type: 'next' });
        continue;
      }
      const id = actor(s)!;
      const o = observe(s, id);
      const world = sampleWorld(o, 19);
      assertState(world);
      const reconstructed = observe(world, id);
      assert.deepEqual(
        { ...reconstructed, publicLog: [] },
        { ...o, publicLog: [] },
      );
      if (!phases.has(`${count}:${o.phase}:${o.auction?.type}`)) {
        for (const action of candidateActions(o))
          assertState(applyAction(world, action));
      }
      phases.add(`${count}:${o.phase}:${o.auction?.type}`);
      s = applyAction(s, chooseAction(o));
    }
  }
  for (const type of ['open', 'once', 'sealed', 'fixed', 'double'])
    assert.ok([...phases].some((p) => p.endsWith(type)));
});

test('both planners are deterministic with fixed simulation budgets and cannot read hidden state', () => {
  const s = createGame(3, 310123);
  const o = observe(s, 0);
  const before = structuredClone(o);
  const altered = structuredClone(s);
  [altered.players[1].hand[0], altered.deck[0]] = [
    altered.deck[0],
    altered.players[1].hand[0],
  ];
  altered.seed++;
  altered.players[1].cash = 999;
  for (const mode of ['rollout', 'ismcts'] as const) {
    const a = plan(o, { mode, iterations: 4 });
    const b = plan(observe(altered, 0), { mode, iterations: 4 });
    assert.deepEqual(a.action, b.action);
    assert.deepEqual(a.candidates, b.candidates);
    assert.equal(a.simulations, 4);
    assertState(applyAction(s, a.action));
  }
  assert.deepEqual(o, before);
});

test('sampled locked sealed bids are complete, affordable, and independent of real bids', () => {
  let s = createGame(4, 1234);
  const card = s.players[0].hand.find((c) => c.type === 'sealed')!;
  s = applyAction(s, { type: 'offer', player: 0, card: card.id });
  s = applyAction(s, { type: 'bid', player: actor(s)!, amount: 17 });
  const id = actor(s)!;
  const a = sampleWorld(observe(s, id), 77);
  s.auction!.bids[1] = 99;
  assert.deepEqual(sampleWorld(observe(s, id), 77), a);
  assert.equal(Object.keys(a.auction!.bids).length, 1);
  for (const [p, bid] of Object.entries(a.auction!.bids))
    assert.ok(bid >= 0 && bid <= a.players[+p].cash);
  let world = a;
  while (world.auction?.type === 'sealed')
    world = applyAction(world, chooseAction(observe(world, actor(world)!)));
  assertState(world);
});

test('last-season forced victory is selected by both planners', () => {
  let s = createGame(3, 24);
  while (!(s.round === 4 && s.phase === 'offer') && s.phase !== 'finished')
    s = applyAction(
      s,
      s.phase === 'roundEnd'
        ? { type: 'next' }
        : chooseAction(observe(s, actor(s)!)),
    );
  assert.equal(s.round, 4);
  const id = actor(s)!;
  s.players[id].cash += 10000;
  s.bankFlow += 10000;
  for (const mode of ['rollout', 'ismcts'] as const) {
    const result = plan(observe(s, id), { mode, iterations: 8 });
    assertState(applyAction(s, result.action));
    assert.ok(
      result.candidates.filter((c) => c.visits).every((c) => c.mean === 1),
    );
  }
});

test('mutable simulation and immutable game transitions agree for whole games', async () => {
  const { advanceSimulation } = await import('../src/game/engine.ts');
  for (const count of [3, 4, 5]) {
    let real = createGame(count, 320000 + count);
    const simulated = structuredClone(real);
    while (real.phase !== 'finished') {
      const action =
        real.phase === 'roundEnd'
          ? { type: 'next' as const }
          : chooseAction(observe(real, actor(real)!));
      const before = structuredClone(real);
      const next = applyAction(real, action);
      assert.deepEqual(real, before);
      real = next;
      advanceSimulation(simulated, action);
      assert.deepEqual(simulated, { ...real, actions: [], log: [] });
      assertState(simulated);
    }
  }
});

test('experimental strategies route through configuration and survive save/reload', async () => {
  const { chooseConfiguredAction } =
    await import('../src/game/ai-configured.ts');
  const { makeLevelConfig, parsePreferences, validAIConfig } =
    await import('../src/game/preferences.ts');
  const { serialize, deserialize } = await import('../src/game/storage.ts');
  for (const mode of ['rollout', 'ismcts'] as const) {
    let s = createGame(3, 310124);
    s.aiConfig = makeLevelConfig(3, mode);
    assert.ok(validAIConfig(s.aiConfig));
    assert.equal(parsePreferences(JSON.stringify({ level: mode })).level, mode);
    s = applyAction(
      s,
      chooseConfiguredAction(observe(s, actor(s)!), s.aiConfig),
    );
    assertState(s);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});
