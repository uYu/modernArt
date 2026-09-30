import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [pool, first, total, parallel, directory] = process.argv.slice(2);
const start = Number(first),
  seeds = Number(total),
  workers = Number(parallel);
if (
  pool !== 'timed' ||
  ![start, seeds, workers].every(Number.isSafeInteger) ||
  seeds < 1 ||
  workers < 1 ||
  workers !== 1 ||
  !directory
)
  throw new Error('Usage: pool start seeds workers directory');
mkdirSync(directory, { recursive: true });
const jobs = Array.from({ length: seeds }, (_, i) =>
  [3, 4, 5].map((count) => ({ seed: start + i, count })),
).flat();
let next = 0;
async function work() {
  while (next < jobs.length) {
    const { seed, count } = jobs[next++];
    await new Promise<void>((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          'experiments/tactical-timed-game.ts',
          pool,
          String(seed),
          String(count),
          resolve(directory, `${pool}-${seed}-${count}.json`),
        ],
        { stdio: 'inherit' },
      );
      child.on('error', fail);
      child.on('exit', (code) =>
        code === 0
          ? done()
          : fail(new Error(`Job ${seed}/${count} exited ${code}`)),
      );
    });
  }
}
await Promise.all(Array.from({ length: workers }, work));
console.log(
  JSON.stringify({ complete: true, pool, start, seeds, jobs: jobs.length }),
);
