import type { SaleNotice } from '../game/sale.ts';
import { ARTISTS, title } from '../game/data.ts';
import { Artwork } from './Artwork.tsx';

export function SaleAnnouncement({
  sale,
  close,
}: {
  sale: SaleNotice;
  close: () => void;
}) {
  const selfPurchase = sale.buyer.id === sale.seller.id;
  return (
    <div className="sale-announcement" role="status" aria-live="polite">
      {sale.cards.at(-1)?.type === 'fixed' && (
        <p className="fixed-sale-context">
          {sale.seller.name} 定价 <strong>{sale.amount} 千元</strong>
          {sale.cards.length === 2 ? '（两幅合计）' : ''}
          {selfPurchase
            ? '，无人接手，由卖家自购'
            : `，${sale.buyer.name} 买下`}
        </p>
      )}
      <p className="sale-buyer">{sale.buyer.name}</p>
      <p className="sale-description">
        {sale.amount === 0 ? '免费取得' : selfPurchase ? '自购' : '买下'}
        {sale.cards.length === 2 ? '这两幅作品' : '这幅作品'}
      </p>
      <div className="sale-artworks">
        {sale.cards.map((card) => (
          <figure key={card.id}>
            <Artwork card={card} />
            <figcaption>
              <strong>{ARTISTS[card.artist].name}</strong>
              <span>{title(card)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="sale-price">
        <strong>{sale.amount}</strong> 千元
        {sale.cards.length === 2 && <span> · 两幅合计</span>}
      </p>
      <p className="sale-payment">
        卖家：{sale.seller.name}
        {sale.amount > 0
          ? selfPurchase
            ? ' · 款项支付给银行'
            : ' · 款项支付给卖家'
          : ' · 无需付款'}
      </p>
      <button className="primary wide" onClick={close}>
        继续拍卖
      </button>
      <p className="sale-auto">确认后继续拍卖</p>
    </div>
  );
}
