// Research diagnostics, not a new AI or a claim of full-game optimality.
// Run with Node >=22.13: node --experimental-strip-types docs/research/auction-diagnostics.mjs
import assert from 'node:assert/strict';
import { createGame, actor, observe, applyAction } from '../../src/game/engine.ts';
import { chooseAction } from '../../src/game/ai-legacy.ts';

const summary = { games: 0, transitions: 0, publicLedgerChecks: 0, sellerOnceRaises: 0, costlySellerRaises: 0, examples: [] };
for (const count of [3, 4, 5]) {
  for (let seed = 1; seed <= 20; seed++) {
    let game = createGame(count, seed);
    const ledger = Array(count).fill(100);
    let steps = 0;
    while (game.phase !== 'finished') {
      assert.ok(++steps < 10000);
      const action = game.phase === 'roundEnd' ? { type: 'next' } : chooseAction(observe(game, actor(game)));
      const auction = game.auction;
      if (game.phase === 'bid' && auction.type === 'once' && action.player === auction.seller && auction.bidder !== null && action.amount !== null) {
        summary.sellerOnceRaises++;
        const artist = auction.cards[0].artist;
        const maxLotPayout = auction.cards.length * (30 + game.history.reduce((v, r) => v + r.awards[artist], 0));
        // Even the maximum payout of this lot, less the self-purchase price,
        // falls below the cash received by accepting the standing bid.
        // This omits strategic downstream effects; it is not a dominance proof.
        if (maxLotPayout - action.amount < auction.high) {
          summary.costlySellerRaises++;
          if (summary.examples.length < 4) summary.examples.push({count, seed, round:game.round, player:action.player, standingBid:auction.high, selfBid:action.amount, maxLotPayout, maxOwnNet:maxLotPayout-action.amount, saleIncome:auction.high});
        }
      }
      const next = applyAction(game, action);
      // Ledger reads only newly published transaction messages and public round settlement.
      // Internal balances below are used solely as an oracle to validate this diagnostic.
      for (const message of next.log.slice(game.log.length)) {
        const match = message.match(/^(.+?) 以 (\d+) 千元购得 .*?（支付给 (.+?)）。$/);
        const bank = message.match(/^(.+?) 以 (\d+) 千元购得 .*?（支付给银行）。$/);
        const tx = match ?? bank;
        if (tx) {
          const buyer = next.players.findIndex(p => p.name === tx[1]);
          assert.ok(buyer >= 0);
          ledger[buyer] -= Number(tx[2]);
          if (match) {
            const seller = next.players.findIndex(p => p.name === match[3]);
            assert.ok(seller >= 0);
            ledger[seller] += Number(tx[2]);
          }
        }
      }
      for (const round of next.history.slice(game.history.length)) round.income.forEach((income, i) => ledger[i] += income);
      assert.deepEqual(ledger, next.players.map(p => p.cash));
      summary.publicLedgerChecks++;
      summary.transitions++;
      game = next;
    }
    summary.games++;
  }
}
// Exact enumeration of a simplified, single-lot, cash-profit objective.
// Opponent maximum is uniform over the specified integer range; ties are lost.
function sealedBest(min, max) {
  const results = Array.from({length:41}, (_, bid) => ({bid, expectedProfit:Array.from({length:max-min+1}, (_, k) => min+k).reduce((sum, rival) => sum+(bid>rival ? 40-bid : 0),0)/(max-min+1)}));
  const best = Math.max(...results.map(r=>r.expectedProfit));
  return {opponentMax:[min,max], lotValue:40, best:results.filter(r=>Math.abs(r.expectedProfit-best)<1e-9)};
}
summary.toySealed = [sealedBest(0,40), sealedBest(20,40)];
console.log(JSON.stringify(summary, null, 2));
