import { ARTISTS, title } from '../game/data.ts';
import type { Card } from '../game/types.ts';
export function Artwork({ card }: { card: Card }) {
  return (
    <img
      className="artwork-image"
      src={`/artworks/artist-${card.artist}-${card.index}.jpg`}
      alt={`${ARTISTS[card.artist].name}《${title(card)}》`}
      width="800"
      height="1000"
      loading="lazy"
      decoding="async"
    />
  );
}
