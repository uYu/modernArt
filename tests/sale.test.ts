import test from 'node:test';
import assert from 'node:assert/strict';
import { actor, applyAction, createGame } from '../src/game/engine.ts';
import { makeDeck } from '../src/game/data.ts';
import { completedSale } from '../src/game/sale.ts';
import type { AuctionType, GameState } from '../src/game/types.ts';
function setup(type: AuctionType) {
  const s = createGame(3, 1),
    cards = makeDeck();
  const card = cards.find((c) => c.artist === 0 && c.type === type)!;
  const filler = cards.find((c) => c.artist === 4)!;
  s.players.forEach((p) => {
    p.hand = [];
    p.collection = [];
  });
  s.players[0].hand = [card];
  s.players[1].hand = [filler];
  s.deck = cards.filter((c) => c.id !== card.id && c.id !== filler.id);
  return s;
}
const offer = (s: GameState) =>
  applyAction(s, { type: 'offer', player: 0, card: s.players[0].hand[0].id });
const bid = (s: GameState, amount: number | null) =>
  applyAction(s, { type: 'bid', player: actor(s)!, amount });

test('只在实际成交时通知，买家、卖家和价格正确', () => {
  let s = offer(setup('once'));
  const pending = bid(s, 17);
  assert.equal(completedSale(s, pending), null);
  s = bid(pending, null);
  const next = bid(s, null),
    notice = completedSale(s, next)!;
  assert.equal(notice.buyer.id, 1);
  assert.equal(notice.seller.id, 0);
  assert.equal(notice.amount, 17);
  assert.deepEqual(notice.cards, s.auction!.cards);
  assert.equal(completedSale(next, next), null);
});
test('暗标自购通知只在揭晓时出现，包含实际成交价', () => {
  let s = offer(setup('sealed'));
  const hidden = bid(s, 12);
  assert.equal(completedSale(s, hidden), null);
  s = bid(hidden, 10);
  const notice = completedSale(s, bid(s, 12))!;
  assert.equal(notice.buyer.id, 0);
  assert.equal(notice.amount, 12);
});
test('无人出价免费取得和一口价购买均有通知', () => {
  let s = offer(setup('open'));
  s = bid(bid(s, null), null);
  const free = completedSale(s, bid(s, null))!;
  assert.equal(free.amount, 0);
  assert.equal(free.buyer.id, 0);
  s = offer(setup('fixed'));
  s = applyAction(s, { type: 'price', player: 0, amount: 20 });
  const paid = completedSale(
    s,
    applyAction(s, { type: 'buy', player: 1, accept: true }),
  )!;
  assert.equal(paid.amount, 20);
  assert.equal(paid.buyer.id, 1);
});
test('双重拍卖在同一通知中包含两幅作品和总价', () => {
  let s = setup('double');
  const i = s.deck.findIndex((c) => c.artist === 0 && c.type === 'once');
  const pair = s.deck.splice(i, 1)[0];
  s.players[0].hand.push(pair);
  s = offer(s);
  s = applyAction(s, { type: 'pair', player: 0, card: pair.id });
  s = bid(bid(s, 23), null);
  const notice = completedSale(s, bid(s, null))!;
  assert.equal(notice.cards.length, 2);
  assert.equal(notice.amount, 23);
});
test('第五张导致流拍结算时不误报成交', () => {
  const s = setup('once');
  s.counts[0] = 4;
  const next = offer(s);
  assert.equal(next.phase, 'roundEnd');
  assert.equal(completedSale(s, next), null);
});
