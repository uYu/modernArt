export type AuctionType = 'open' | 'once' | 'sealed' | 'fixed' | 'double';
export interface Card {
  id: string;
  artist: number;
  type: AuctionType;
  index: number;
}
export interface Player {
  id: number;
  name: string;
  cash: number;
  hand: Card[];
  collection: Card[];
}
export interface Auction {
  seller: number;
  cards: Card[];
  type: AuctionType;
  high: number;
  bidder: number | null;
  price: number | null;
  queue: number[];
  bids: Record<number, number>;
}
export type Phase =
  'offer' | 'pair' | 'price' | 'bid' | 'roundEnd' | 'finished';
export interface PublicTransaction {
  round: number;
  seller: number;
  buyer: number;
  amount: number;
  cards: Card[];
}
export interface RoundResult {
  unsold: Card[];
  round: number;
  counts: number[];
  awards: number[];
  values: number[];
  income: number[];
  sold: Card[][];
  reason: string;
}
export interface GameState {
  aiConfig?: import('./preferences.ts').AIConfig;
  version: 1;
  seed: number;
  first: number;
  round: number;
  turn: number;
  phase: Phase;
  players: Player[];
  deck: Card[];
  discarded: Card[];
  counts: number[];
  history: RoundResult[];
  auction: Auction | null;
  log: string[];
  transactions: PublicTransaction[];
  actions: Action[];
  bankFlow: number;
}
export type Action =
  | { type: 'offer'; player: number; card: string }
  | { type: 'pair'; player: number; card: string | null }
  | { type: 'price'; player: number; amount: number }
  | { type: 'bid'; player: number; amount: number | null }
  | { type: 'buy'; player: number; accept: boolean }
  | { type: 'next' };
// This is the only information an AI receives: no deck, seed, other hands,
// other cash balances, sealed bids, or action history.
export interface Observation {
  round: number;
  turn: number;
  phase: Phase;
  self: Player;
  players: { id: number; handCount: number; collection: Card[] }[];
  counts: number[];
  awards: number[][];
  // Only already-public events and face-up cards; never unsubmitted/locked bids.
  publicLog: string[];
  transactions: PublicTransaction[];
  settledIncome: number[];
  revealed: Card[];
  names: string[];
  auction: Omit<Auction, 'bids'> | null;
}
