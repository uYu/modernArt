import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  actor,
  applyAction,
  assertState,
  createGame,
  observe,
} from '../src/game/engine.ts';
import { chooseAction, AI_VERSION } from '../src/game/ai.ts';
import { ARTISTS } from '../src/game/data.ts';
import { serialize, deserialize } from '../src/game/storage.ts';
import assert from 'node:assert/strict';

const rows = [];
const started = Date.now();
for (let i = 0; i < 200; i++) {
  const seed = 2026091800 + i;
  const first = i % 4;
  let s = createGame(4, seed, first);
  while (s.phase !== 'finished') {
    if (s.actions.length >= 10000)
      throw new Error(`Game ${i + 1} failed to terminate`);
    s = applyAction(
      s,
      s.phase === 'roundEnd'
        ? { type: 'next' }
        : chooseAction(observe(s, actor(s)!)),
    );
    assertState(s);
  }
  const save = JSON.parse(serialize(s));
  assert.deepEqual(deserialize(JSON.stringify(save)), s);
  for (const h of s.history) {
    assert.equal(h.awards.length, 5);
    assert.ok(h.awards.every((n) => [0, 10, 20, 30].includes(n)));
  }
  rows.push({
    game: i + 1,
    seed,
    first,
    rounds: s.history.length,
    awards: s.history.map((h) => h.awards),
    cash: s.players.map((p) => p.cash),
    actions: s.actions.length,
    save,
  });
  if ((i + 1) % 20 === 0)
    console.log(
      `${i + 1}/200 complete (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
}
const fingerprint = createHash('sha256');
for (const file of [
  'ai.ts',
  'ai-search.ts',
  'ai-legacy.ts',
  'engine.ts',
  'data.ts',
  'ledger.ts',
])
  fingerprint.update(
    readFileSync(new URL(`../src/game/${file}`, import.meta.url)),
  );
const metadata = {
  ai: AI_VERSION,
  players: 4,
  games: rows.length,
  firstSeed: rows[0].seed,
  lastSeed: rows.at(-1)!.seed,
  sourceHash: fingerprint.digest('hex'),
  generatedAt: new Date().toISOString(),
  measure:
    'RoundResult.awards — per-season award, identical to the in-game price history table; not cumulative liquidation value.',
  seconds: (Date.now() - started) / 1000,
};
writeFileSync(
  'reports/season-prices-200.json',
  JSON.stringify({ metadata, rows }, null, 2),
);
const csv = ['局号,随机种子,艺术家,第1季,第2季,第3季,第4季'];
for (const r of rows)
  for (let a = 0; a < 5; a++)
    csv.push(
      [
        r.game,
        r.seed,
        ARTISTS[a].name,
        ...Array.from({ length: 4 }, (_, i) => r.awards[i]?.[a] ?? ''),
      ].join(','),
    );
writeFileSync('reports/season-prices-200.csv', '\ufeff' + csv.join('\r\n'));
const cards = rows
  .map(
    (r) =>
      `<article id="game-${r.game}" data-game="${r.game}"><header><h2>第 ${String(r.game).padStart(3, '0')} 局</h2><span>种子 ${r.seed}</span></header><div class="title"><h3>历季定价</h3><small>同量时，从上到下优先</small></div><table aria-label="第 ${r.game} 局历季定价"><thead><tr><th>艺术家</th>${[1, 2, 3, 4].map((i) => `<th>${i} 季</th>`).join('')}</tr></thead><tbody>${ARTISTS.map((a, j) => `<tr><th><span style="border-color:${a.color}">${a.name}</span></th>${[0, 1, 2, 3].map((k) => `<td>${r.awards[k]?.[j] || '—'}</td>`).join('')}</tr>`).join('')}</tbody></table><footer>终局资金（座位顺序）：${r.cash.join(' / ')} 千元<br>${r.rounds} 季 · ${r.actions} 次行动</footer></article>`,
  )
  .join('\n');
writeFileSync(
  'reports/season-prices-200.html',
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>现代艺术 · 200 局历季定价</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f0e7;color:#30372f;font:15px system-ui,-apple-system,sans-serif}main{max-width:1500px;margin:auto;padding:28px}h1{font-size:27px;margin:0 0 12px}.intro{line-height:1.8;color:#687160}.toolbar{position:sticky;top:0;background:#f2f0e7f5;padding:12px 0;z-index:2;display:flex;gap:12px;flex-wrap:wrap;align-items:center}.toolbar input{width:90px;padding:8px;border:1px solid #bdc3b3}.toolbar button,.toolbar a{padding:8px 12px;border:1px solid #bdc3b3;background:#fffdf7;color:inherit;text-decoration:none;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}article{background:#faf9f3;border:1px solid #d9ddcf;padding:20px;scroll-margin-top:75px;break-inside:avoid}article:target{outline:3px solid #758163}header,.title{display:flex;align-items:center;justify-content:space-between;gap:8px}h2{font-size:15px;margin:0}header span,small{font-size:11px;color:#828977}h3{font-size:22px;margin:18px 0 10px}table{width:100%;border-spacing:5px 7px;text-align:center;table-layout:fixed}th{font-weight:500;color:#858d7d;font-size:13px}thead th{padding-bottom:7px}tbody th{color:#30372f;font-size:17px;font-weight:600}tbody th span{display:block;border-left:4px solid;padding:5px 0}td{background:#efefe7;padding:12px 3px;font-size:18px;color:#737e64}footer{border-top:1px solid #dedfd4;margin-top:12px;padding-top:12px;font-size:11px;color:#7d8573;line-height:1.7}.meta{font-size:11px;overflow-wrap:anywhere;margin:24px 0;color:#7d8573}@media(max-width:400px){main{padding:14px}.grid{grid-template-columns:1fr}article{padding:12px}}@media print{.toolbar{display:none}.grid{grid-template-columns:repeat(2,1fr)}main{padding:0}article{padding:12px}body{background:white}}
</style><main><h1>现代艺术 · 200 局历季定价</h1><p class="intro">四人局，全员使用最新版 AI ${AI_VERSION}（含跳价策略），先手轮换，固定种子可复现。<br>表格与游戏中的“历季定价”使用同一字段：每季新增定价 30 / 20 / 10；“—”表示该季未上榜，非累计卖出价格。${rows.some((r) => r.rounds < 4) ? '部分对局因手牌耗尽提前结束，尚未进行的季也显示“—”。' : '全部对局均完成四季。'}</p><nav class="toolbar"><label>跳到第 <input id="number" type="number" min="1" max="200" value="1"> 局</label><button id="jump">查看</button><a href="season-prices-200.csv" download>下载 CSV</a><a href="season-prices-200.json" download>下载数据与重放记录</a><span>200 / 200 局完成 · 状态与存档重放校验通过</span></nav><div class="grid">${cards}</div><p class="meta">种子 ${metadata.firstSeed}–${metadata.lastSeed} · 模拟耗时 ${metadata.seconds.toFixed(1)} 秒<br>代码指纹 ${metadata.sourceHash}</p></main><script>document.getElementById('jump').onclick=()=>{const n=Number(document.getElementById('number').value);if(Number.isInteger(n)&&n>=1&&n<=200)location.hash='game-'+n;};document.getElementById('number').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('jump').click();});</script></html>`,
);
console.log(JSON.stringify(metadata, null, 2));
