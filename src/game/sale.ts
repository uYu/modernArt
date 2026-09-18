import type { Card, GameState } from './types.ts';

export interface SaleNotice {
  buyer: { id: number; name: string };
  seller: { id: number; name: string };
  cards: Card[];
  amount: number;
}

// Detect ownership transfer, not log text: fifth-card round endings aren't sales.
export function completedSale(
  before: GameState,
  after: GameState,
): SaleNotice | null {
  const auction = before.auction;
  if (!auction || after.auction || after.phase !== 'offer') return null;
  const buyer = after.players.find((p) =>
    auction.cards.every((c) => p.collection.some((owned) => owned.id === c.id)),
  );
  if (!buyer) return null;
  const seller = before.players[auction.seller];
  return {
    buyer: { id: buyer.id, name: buyer.name },
    seller: { id: seller.id, name: seller.name },
    cards: [...auction.cards],
    amount: before.players[buyer.id].cash - buyer.cash,
  };
}

// In a double auction the second card determines the actual auction method.
export function requiresSaleConfirmation(
  sale: SaleNotice,
  mode: 'brief' | 'confirm',
) {
  return mode === 'confirm' || sale.cards.at(-1)?.type === 'fixed';
}
