import { ledgerBalances } from './ledger.ts';
import { makeDeck } from './data.ts';
import type { AuctionType, GameState } from './types.ts';
export const AUCTION_TYPES: AuctionType[] = [
  'open',
  'once',
  'sealed',
  'fixed',
  'double',
];

// Reconstruct balances from public payments and season settlements only.
export function publicBalances(game: GameState) {
  return ledgerBalances(
    game.players.map((_, i) =>
      game.history.reduce((sum, r) => sum + r.income[i], 0),
    ),
    game.transactions,
  );
}

// Memory aid: never read hands, the undealt deck, hidden balances or sealed bids.
export function inspectGame(game: GameState, round: number) {
  const deck = makeDeck();
  const revealed = [
    ...new Map(
      [
        ...game.discarded,
        ...game.players.flatMap((p) => p.collection),
        ...(game.auction?.cards ?? []),
      ].map((c) => [c.id, c]),
    ).values(),
  ];
  const cash = publicBalances(game);
  const history = game.history.find((r) => r.round === round);
  const seasonSales = Array.from({ length: 4 }, (_, i) => {
    const season = i + 1;
    const settled = game.history.find((r) => r.round === season);
    const cards = settled
      ? settled.sold.flat()
      : season === game.round
        ? game.players.flatMap((p) => p.collection)
        : null;
    return cards === null
      ? null
      : Array.from(
          { length: 5 },
          (_, artist) => cards.filter((c) => c.artist === artist).length,
        );
  });
  return {
    seasonSales,
    seasonUnsold: seasonSales.map((sold, i) => {
      const settled = game.history.find((r) => r.round === i + 1);
      return sold?.map((n, a) => (settled ? settled.counts[a] - n : 0)) ?? null;
    }),
    counts: Array.from({ length: 5 }, (_, artist) =>
      AUCTION_TYPES.map((type) => {
        const matching = (c: (typeof deck)[number]) =>
          c.artist === artist && c.type === type;
        const total = deck.filter(matching).length;
        return {
          remaining: total - revealed.filter(matching).length,
          total,
        };
      }),
    ),
    players: game.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      cash: cash[i],
      bought: history
        ? history.sold[i]
        : round === game.round
          ? p.collection
          : [],
      settlement: history?.income[i],
    })),
  };
}

export function seasonDetails(game: GameState, round: number, artist: number) {
  const purchases = game.transactions
    .filter((tx) => tx.round === round)
    .flatMap((tx) =>
      tx.cards
        .filter((c) => c.artist === artist)
        .map((card) => ({
          card,
          buyer: game.players[tx.buyer].name,
          seller: game.players[tx.seller].name,
          amount: tx.amount,
          bundle: tx.cards.length,
          unsold: false,
        })),
    );
  const unsold = game.history.find((r) => r.round === round)?.unsold ?? [];
  return [
    ...purchases,
    ...unsold
      .filter((c) => c.artist === artist)
      .map((card) => ({
        card,
        buyer: '',
        seller: '',
        amount: 0,
        bundle: 0,
        unsold: true,
      })),
  ];
}
