import type { PublicTransaction } from './types.ts';

// Only settled, public payments; bids never enter this ledger.
export function ledgerBalances(
  income: number[],
  transactions: PublicTransaction[],
) {
  const cash = income.map((n) => 100 + n);
  for (const tx of transactions) {
    cash[tx.buyer] -= tx.amount;
    if (tx.buyer !== tx.seller) cash[tx.seller] += tx.amount;
  }
  return cash;
}
