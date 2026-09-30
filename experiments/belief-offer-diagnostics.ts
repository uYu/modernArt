import { actor, applyAction, createGame, observe } from '../src/game/engine.ts';
import { chooseImprovedAction } from '../src/game/ai-improved.ts';
import { offerScore } from '../src/game/ai-legacy.ts';
const rows: {
  count: number;
  percentile: number;
  chosen: number;
  average: number;
}[] = [];
const actionRows: { scores: number[]; chosen: number }[] = [];
let pairPass = 0,
  pairPassWithCard = 0,
  pairAccept = 0;
for (const count of [3, 4, 5])
  for (let seed = 710001; seed <= 710004; seed++) {
    let s = createGame(count, seed, seed % count);
    while (s.phase !== 'finished') {
      if (s.phase === 'roundEnd') {
        s = applyAction(s, { type: 'next' });
        continue;
      }
      const o = observe(s, actor(s)!);
      const action = chooseImprovedAction(o);
      if (action.type === 'pair') {
        if (action.card === null) {
          pairPass++;
          if (
            o.self.hand.some(
              (c) =>
                c.artist === o.auction!.cards[0].artist && c.type !== 'double',
            )
          )
            pairPassWithCard++;
        } else pairAccept++;
      }
      if (action.type === 'offer' && o.self.hand.length > 1) {
        const scores = o.self.hand.map((card) => offerScore(o, card));
        const index = o.self.hand.findIndex((card) => card.id === action.card);
        actionRows.push({ scores, chosen: index });
        const chosen = scores[index];
        const percentile =
          scores.filter((x) => x < chosen).length / (scores.length - 1);
        rows.push({
          count,
          percentile,
          chosen,
          average: scores.reduce((a, b) => a + b, 0) / scores.length,
        });
      }
      s = applyAction(s, action);
    }
  }
for (const count of [3, 4, 5]) {
  const subset = rows.filter((x) => x.count === count);
  console.log({
    count,
    n: subset.length,
    meanPercentile:
      subset.reduce((s, x) => s + x.percentile, 0) / subset.length,
    meanAdvantage:
      subset.reduce((s, x) => s + x.chosen - x.average, 0) / subset.length,
  });
}
console.log({ pairPass, pairPassWithCard, pairAccept });
const grid = [];
for (const temperature of [5, 10, 18, 30, 50])
  for (const epsilon of [0.05, 0.2, 0.4, 0.6]) {
    const loss =
      actionRows.reduce((sum, row) => {
        const max = Math.max(...row.scores);
        const values = row.scores.map((x) => Math.exp((x - max) / temperature));
        const p =
          epsilon / row.scores.length +
          ((1 - epsilon) * values[row.chosen]) /
            values.reduce((a, b) => a + b, 0);
        return sum - Math.log(p);
      }, 0) / actionRows.length;
    grid.push({ temperature, epsilon, loss });
  }
console.log(grid.sort((a, b) => a.loss - b.loss).slice(0, 10));
console.log({
  uniformLoss:
    actionRows.reduce((s, r) => s + Math.log(r.scores.length), 0) /
    actionRows.length,
});
