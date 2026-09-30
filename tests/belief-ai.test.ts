import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { observationSeed, sampleWorld } from '../src/game/ai-planning.ts';
import {
  offerLogLikelihood,
  sampleBeliefWorlds,
} from '../src/game/ai-belief.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { searchAuction } from '../src/game/ai-universal.ts';

function laterAuction() {
  let s = createGame(4, 798001);
  let steps = 0;
  while (s.phase !== 'finished' && ++steps < 1200) {
    if (
      s.phase !== 'offer' &&
      s.phase !== 'pair' &&
      s.publicPlays.some(
        (x) =>
          x.round === s.round && x.player !== actor(s) && x.phase === 'offer',
      )
    )
      return s;
    s = applyAction(
      s,
      s.phase === 'roundEnd'
        ? { type: 'next' }
        : chooseImprovedAction(observe(s, actor(s)!)),
    );
  }
  throw new Error('No suitable auction');
}

test('public play history records face-up cards and excludes hidden auction actions', () => {
  const s = laterAuction();
  const o = observe(s, actor(s)!);
  assert.ok(o.publicPlays.length > 0);
  for (const play of o.publicPlays) {
    if (play.card)
      assert.ok(o.revealed.some((card) => card.id === play.card!.id));
    assert.equal(play.countsBefore.length, 5);
    assert.equal(play.collectionsBefore.length, s.players.length);
  }
  assert.deepEqual(o.publicPlays, s.publicPlays);
  assert.equal(JSON.stringify(o).includes('"bids"'), false);
  assert.ok(!('deck' in o));
  assert.ok(!('actions' in o));
});

test('played-card posterior is deterministic, legal and observation-only', () => {
  const s = laterAuction();
  const id = actor(s)!;
  const o = observe(s, id);
  const worlds = sampleBeliefWorlds(o, 211, 8, 16);
  assert.equal(worlds.length, 8);
  for (const { world } of worlds) {
    assertState(world);
    assert.deepEqual(world.publicPlays, o.publicPlays);
    assert.ok(Number.isFinite(offerLogLikelihood(o, world)));
  }
  const changed = structuredClone(s);
  [changed.players[(id + 1) % s.players.length].hand[0], changed.deck[0]] = [
    changed.deck[0],
    changed.players[(id + 1) % s.players.length].hand[0],
  ];
  changed.seed++;
  if (changed.auction?.type === 'sealed') changed.auction.bids[0] = 89;
  assert.deepEqual(observe(changed, id), o);
  assert.equal(observationSeed(o), observationSeed({ ...o, publicPlays: [] }));
  assert.deepEqual(
    sampleBeliefWorlds(observe(changed, id), 211, 8, 16),
    worlds,
  );
  const action = searchAuction(o, {
    belief: 'played',
    samples: 8,
    budgetMs: 10000,
  }).action;
  assertState(applyAction(s, action));
});

test('public choices give sampled hands non-uniform likelihood', () => {
  const s = laterAuction();
  const o = observe(s, actor(s)!);
  const weights = Array.from({ length: 16 }, (_, i) =>
    offerLogLikelihood(o, sampleWorld(o, i + 12)),
  );
  assert.ok(new Set(weights.map((x) => x.toFixed(6))).size > 1);
});
