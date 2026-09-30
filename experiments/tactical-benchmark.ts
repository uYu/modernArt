import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseUniversalAction } from '../src/game/ai-universal.ts';
import {
  searchTacticalOffer,
  TACTICAL_VERSION,
} from '../src/game/ai-tactical.ts';
import type { Action } from '../src/game/types.ts';

const start = Number(process.argv[2] ?? 928101);
const seeds = Number(process.argv[3] ?? 1);
const output = process.argv[4] ?? 'experiments/tactical-pilot-928101.json';
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(seeds) || seeds < 1)
  throw new Error('Invalid seed range');
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
const files = [
  'engine',
  'types',
  'data',
  'ledger',
  'ai',
  'ai-legacy',
  'ai-search',
  'ai-expert-baseline',
  'ai-improved',
  'ai-universal',
  'ai-planning',
  'ai-belief',
  'ai-tactical',
].map((name) => `src/game/${name}.ts`);
files.push(
  'experiments/tactical-benchmark.ts',
  'experiments/tactical-validation-plan.md',
);
const hashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
const options = {
  samples: 8,
  replySamples: 2,
  budgetMs: 1000,
  depth: 2 as const,
};
type Decision = {
  round: number;
  phase: string;
  counts: number[];
  action: Action;
  reference: Action;
  changed: boolean;
  completedSamples: number;
  nextDecisionSearches: number;
  elapsedMs: number;
};
type Row = {
  seed: number;
  count: number;
  seat: number | null;
  cash: number[];
  wins: number[];
  actions: Action[];
  decisions: Decision[];
};
const rows: Row[] = [];
function save() {
  const deltas = rows
    .filter((r) => r.seat !== null)
    .map((r) => {
      const base = rows.find(
        (b) => b.seed === r.seed && b.count === r.count && b.seat === null,
      )!;
      return {
        seed: r.seed,
        count: r.count,
        seat: r.seat,
        difference: r.wins[r.seat!] - base.wins[r.seat!],
      };
    });
  const byCount = [3, 4, 5].map((count) => {
    const ds = deltas.filter((d) => d.count === count);
    return {
      count,
      games: ds.length,
      difference: ds.length
        ? ds.reduce((s, d) => s + d.difference, 0) / ds.length
        : null,
    };
  });
  const timing = rows
    .flatMap((r) => r.decisions.map((d) => d.elapsedMs))
    .sort((a, b) => a - b);
  writeFileSync(
    output,
    JSON.stringify(
      {
        version: TACTICAL_VERSION,
        start,
        seeds,
        scope:
          'development pilot; one candidate at every seat vs current experts; not independent validation',
        options,
        hashes,
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        byCount,
        equalCountDifference: byCount.every((r) => r.difference !== null)
          ? byCount.reduce((s, r) => s + r.difference!, 0) / 3
          : null,
        timing: {
          decisions: timing.length,
          meanMs: timing.reduce((s, x) => s + x, 0) / (timing.length || 1),
          p95Ms:
            timing[Math.max(0, Math.ceil(timing.length * 0.95) - 1)] ?? null,
          maxMs: timing.at(-1) ?? null,
        },
        rows,
      },
      null,
      2,
    ),
  );
}
for (let seed = start; seed < start + seeds; seed++)
  for (const count of [3, 4, 5]) {
    for (const seat of [null, ...Array.from({ length: count }, (_, i) => i)]) {
      let s = createGame(count, seed, seed % count);
      const actions: Action[] = [];
      const decisions: Decision[] = [];
      while (s.phase !== 'finished') {
        if (actions.length > 5000) throw new Error('Game did not terminate');
        let action: Action;
        if (s.phase === 'roundEnd') action = { type: 'next' };
        else {
          const id = actor(s)!;
          const o = observe(s, id);
          if (id === seat && (s.phase === 'offer' || s.phase === 'pair')) {
            const r = searchTacticalOffer(o, options);
            action = r.action;
            decisions.push({
              round: o.round,
              phase: o.phase,
              counts: o.counts,
              action,
              reference: r.reference,
              changed: JSON.stringify(action) !== JSON.stringify(r.reference),
              completedSamples: r.completedSamples,
              nextDecisionSearches: r.nextDecisionSearches,
              elapsedMs: r.elapsedMs,
            });
          } else action = chooseUniversalAction(o);
        }
        actions.push(action);
        s = applyAction(s, action);
        assertState(s);
      }
      const cash = s.players.map((p) => p.cash);
      const max = Math.max(...cash);
      const ties = cash.filter((v) => v === max).length;
      rows.push({
        seed,
        count,
        seat,
        cash,
        wins: cash.map((v) => (v === max ? 1 / ties : 0)),
        actions,
        decisions,
      });
      save();
      console.log(
        JSON.stringify({
          seed,
          count,
          seat,
          cash,
          changes: decisions.filter((d) => d.changed).length,
        }),
      );
    }
  }
