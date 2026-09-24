import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ARTISTS, makeDeck, title, TYPES } from '../game/data.ts';
import type { Card } from '../game/types.ts';
import { Artwork } from './Artwork.tsx';

const deck = makeDeck();

export function ArtGallery() {
  const [artist, setArtist] = useState<number | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const featureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected)
      featureRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
  }, [selected]);
  return (
    <div className="art-gallery">
      <p>五位画家，70 幅独立作品。点击画作可放大欣赏。</p>
      <div className="gallery-filters" role="group" aria-label="筛选画家">
        <button
          className={artist === null ? 'active' : ''}
          onClick={() => setArtist(null)}
        >
          全部 · 70
        </button>
        {ARTISTS.map((a, index) => (
          <button
            key={a.name}
            className={artist === index ? 'active' : ''}
            onClick={() => setArtist(index)}
          >
            {a.name} · {deck.filter((card) => card.artist === index).length}
          </button>
        ))}
      </div>
      {selected && (
        <div
          ref={featureRef}
          className="gallery-feature"
          style={
            { '--artist': ARTISTS[selected.artist].color } as CSSProperties
          }
        >
          <Artwork card={selected} />
          <div>
            <span className="eyebrow">SELECTED WORK</span>
            <h3>{title(selected)}</h3>
            <p>
              {ARTISTS[selected.artist].name} · {ARTISTS[selected.artist].style}
            </p>
            <p>拍卖方式：{TYPES[selected.type].name}</p>
            <button className="secondary" onClick={() => setSelected(null)}>
              收起大图
            </button>
          </div>
        </div>
      )}
      <div className="gallery-grid">
        {deck
          .filter((card) => artist === null || card.artist === artist)
          .map((card) => (
            <button
              className="gallery-tile"
              key={card.id}
              onClick={() => setSelected(card)}
              style={
                { '--artist': ARTISTS[card.artist].color } as CSSProperties
              }
            >
              <Artwork card={card} />
              <span>
                <strong>{title(card)}</strong>
                <small>
                  {ARTISTS[card.artist].name} · {TYPES[card.type].name}
                </small>
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
