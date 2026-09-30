import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseLevelAction } from '../src/game/ai-levels.ts';
import { plan, PLANNING_VERSION } from '../src/game/ai-planning.ts';

const start = Number(process.argv[2] ?? 330001);
const seeds = Number(process.argv[3] ?? 2);
const iterations = Number(process.argv[4] ?? 48);
const output = process.argv[5] ?? 'experiments/planning-pilot.json';
const timeMs = process.argv[6] ? Number(process.argv[6]) : undefined;
const variants = ['expert', 'rollout', 'ismcts'] as const;
const sourceFiles = [
  'engine',
  'ai-planning',
  'ai-levels',
  'ai',
  'ai-search',
  'ai-legacy',
  'ledger',
  'data',
  'types',
].map((x) => `src/game/${x}.ts`);
const hashes = Object.fromEntries(
  [...sourceFiles, 'experiments/planning-benchmark.ts'].map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
const rows: {
  variant: string;
  count: number;
  seed: number;
  seat: number;
  win: number;
  cash: number[];
  decisions: number;
  simulations: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}[] = [];
function save() {
  writeFileSync(
    output,
    JSON.stringify(
      {
        version: PLANNING_VERSION,
        start,
        seeds,
        iterations,
        timeMs,
        scope:
          'offer/pair only; other actions use current expert; opponents hard',
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        hashes,
        rows,
      },
      null,
      2,
    ),
  );
}
for (const count of [3, 4, 5]) {
  for (let seed = start; seed < start + seeds; seed++) {
    for (let seat = 0; seat < count; seat++)
      for (const variant of variants) {
        let s = createGame(count, seed, seed % count);
        const times: number[] = [];
        let simulations = 0;
        let steps = 0;
        while (s.phase !== 'finished') {
          if (++steps > 5000) throw new Error('nontermination');
          if (s.phase === 'roundEnd') {
            s = applyAction(s, { type: 'next' });
            continue;
          }
          const id = actor(s)!;
          const o = observe(s, id);
          let action;
          if (
            id === seat &&
            variant !== 'expert' &&
            (s.phase === 'offer' || s.phase === 'pair')
          ) {
            const result = plan(o, { mode: variant, iterations, timeMs });
            action = result.action;
            simulations += result.simulations;
            times.push(result.elapsedMs);
          } else {
            const startTime = performance.now();
            action = chooseLevelAction(o, id === seat ? 'expert' : 'hard');
            if (id === seat && (s.phase === 'offer' || s.phase === 'pair'))
              times.push(performance.now() - startTime);
          }
          s = applyAction(s, action);
          assertState(s);
        }
        times.sort((a, b) => a - b);
        const cash = s.players.map((p) => p.cash);
        const max = Math.max(...cash);
        rows.push({
          variant,
          count,
          seed,
          seat,
          cash,
          win:
            cash[seat] === max ? 1 / cash.filter((c) => c === max).length : 0,
          decisions: times.length,
          simulations,
          meanMs: times.reduce((s, x) => s + x, 0) / Math.max(1, times.length),
          p95Ms: times[Math.floor(times.length * 0.95)] ?? 0,
          maxMs: times.at(-1) ?? 0,
        });
      }
    save();
    console.log(
      JSON.stringify({ count, completedSeed: seed, games: rows.length }),
    );
  }
  for (const variant of variants) {
    const selected = rows.filter(
      (r) => r.count === count && r.variant === variant,
    );
    console.log(
      JSON.stringify({
        count,
        variant,
        games: selected.length,
        win: selected.reduce((s, r) => s + r.win, 0) / selected.length,
        meanMs:
          selected.reduce((s, r) => s + r.meanMs * r.decisions, 0) /
          selected.reduce((s, r) => s + r.decisions, 0),
      }),
    );
  }
}
