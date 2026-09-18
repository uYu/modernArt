import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ARTISTS, TYPES, title } from '../game/data.ts';
import {
  AUCTION_TYPES,
  inspectGame,
  seasonDetails,
} from '../game/inspection.ts';
import type { GameState } from '../game/types.ts';
import { Artwork } from './Artwork.tsx';

export function CheatPanel({
  game,
  disable,
}: {
  game: GameState;
  disable: () => void;
}) {
  const [tab, setTab] = useState<'cash' | 'seasons' | 'remaining'>('seasons');
  const [detail, setDetail] = useState<{
    round: number;
    artist: number;
  } | null>(null);
  const [round, setRound] = useState(game.round);
  const data = inspectGame(game, round);
  const totalRemaining = data.counts
    .flat()
    .reduce((sum, c) => sum + c.remaining, 0);
  return (
    <div className="cheat-panel">
      <div className="cheat-notice">
        <span>公开记牌辅助 · 查看期间 AI 暂停</span>
        <button className="text-button" onClick={disable}>
          关闭记牌辅助
        </button>
      </div>
      <nav className="memory-tabs" aria-label="记牌分类">
        {(
          [
            ['cash', '现金'],
            ['seasons', '各季出牌'],
            ['remaining', '剩余牌'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'selected' : ''}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setDetail(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'cash' && (
        <section aria-label="所有玩家当前现金">
          <h3>
            当前现金 <small>千元 · 根据公开交易与结算推算</small>
          </h3>
          <div className="cheat-wallets">
            {data.players.map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <strong>{p.cash}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === 'remaining' && (
        <section>
          <h3>
            剩余牌 <small>尚未公开亮相，共 {totalRemaining} 张</small>
          </h3>
          <p className="cheat-help">
            剩余 = 牌组总量 − 已公开亮相的牌（含未成交的终季牌）。每格为“剩余 /
            总量”。 不展示对手手牌，也不区分剩余牌在谁手里或牌堆中。
          </p>
          <div
            className="cheat-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="按艺术家和拍卖方式统计的剩余牌"
          >
            <table className="cheat-table">
              <thead>
                <tr>
                  <th scope="col">艺术家</th>
                  {AUCTION_TYPES.map((t) => (
                    <th scope="col" key={t}>
                      {TYPES[t].name}
                    </th>
                  ))}
                  <th scope="col">合计</th>
                </tr>
              </thead>
              <tbody>
                {data.counts.map((row, a) => (
                  <tr key={a}>
                    <th
                      scope="row"
                      style={{ '--artist': ARTISTS[a].color } as CSSProperties}
                    >
                      {ARTISTS[a].name}
                    </th>
                    {row.map((c, t) => (
                      <td
                        key={t}
                        title={`已公开亮相 ${c.total - c.remaining} 张`}
                      >
                        <strong>{c.remaining}</strong>
                        <span> / {c.total}</span>
                      </td>
                    ))}
                    <td>
                      <strong>
                        {row.reduce((sum, c) => sum + c.remaining, 0)}
                      </strong>
                      <span> / {row.reduce((sum, c) => sum + c.total, 0)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">合计</th>
                  {AUCTION_TYPES.map((type, t) => (
                    <td key={type}>
                      <strong>
                        {data.counts.reduce(
                          (sum, row) => sum + row[t].remaining,
                          0,
                        )}
                      </strong>
                      <span>
                        {' '}
                        /{' '}
                        {data.counts.reduce(
                          (sum, row) => sum + row[t].total,
                          0,
                        )}
                      </span>
                    </td>
                  ))}
                  <td>
                    <strong>{totalRemaining}</strong>
                    <span>
                      {' '}
                      /{' '}
                      {data.counts.flat().reduce((sum, c) => sum + c.total, 0)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
      {tab === 'seasons' && (
        <section aria-label="各季各画家出牌数量">
          <h3>
            各季各画家出牌数量 <small>单位：张</small>
          </h3>
          <p className="cheat-help">
            例如 5(1) 表示共出牌 5 张，其中 1
            张随季末结束而未成交；无季末未成交牌时只显示数量。本季正在拍卖的牌暂不计入，“—”表示尚未开始。
          </p>
          <div
            className="cheat-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="各季出牌数量表"
          >
            <table className="cheat-table">
              <thead>
                <tr>
                  <th scope="col">艺术家</th>
                  {data.seasonSales.map((_, i) => (
                    <th scope="col" key={i}>
                      第 {i + 1} 季{i + 1 === game.round ? '（本季）' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ARTISTS.map((artist, a) => (
                  <tr key={artist.name}>
                    <th
                      scope="row"
                      style={{ '--artist': artist.color } as CSSProperties}
                    >
                      {artist.name}
                    </th>
                    {data.seasonSales.map((counts, i) => (
                      <td key={i}>
                        <button
                          className="count-detail"
                          disabled={!counts}
                          aria-label={`查看第 ${i + 1} 季${artist.name}出牌明细`}
                          onClick={() => setDetail({ round: i + 1, artist: a })}
                        >
                          <strong>
                            {counts
                              ? counts[a] + (data.seasonUnsold[i]?.[a] ?? 0)
                              : '—'}
                            {data.seasonUnsold[i]?.[a]
                              ? `(${data.seasonUnsold[i]![a]})`
                              : ''}
                          </strong>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">合计</th>
                  {data.seasonSales.map((counts, i) => (
                    <td key={i}>
                      <strong>
                        {counts
                          ? counts.reduce((sum, n) => sum + n, 0) +
                            (data.seasonUnsold[i]?.reduce(
                              (sum, n) => sum + n,
                              0,
                            ) ?? 0)
                          : '—'}
                        {data.seasonUnsold[i]?.some((n) => n > 0)
                          ? `(${data.seasonUnsold[i]!.reduce((sum, n) => sum + n, 0)})`
                          : ''}
                      </strong>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === 'seasons' && detail && (
        <section className="memory-detail" aria-live="polite">
          <div className="cheat-round-heading">
            <h3>
              第 {detail.round} 季 · {ARTISTS[detail.artist].name}
            </h3>
            <button className="text-button" onClick={() => setDetail(null)}>
              收起明细
            </button>
          </div>
          <div className="cheat-cards">
            {seasonDetails(game, detail.round, detail.artist).map((entry) => (
              <div
                className="cheat-card"
                key={entry.card.id}
                style={
                  {
                    '--artist': ARTISTS[entry.card.artist].color,
                  } as CSSProperties
                }
              >
                <Artwork card={entry.card} />
                <div>
                  <strong>{title(entry.card)}</strong>
                  {entry.unsold ? (
                    <span>季末未成交</span>
                  ) : (
                    <>
                      <span>买家：{entry.buyer}</span>
                      <small>卖家：{entry.seller}</small>
                      <small>
                        {entry.amount} 千元
                        {entry.bundle === 2
                          ? '（双画合计，非单张价格）'
                          : entry.amount === 0
                            ? ' · 免费取得'
                            : ''}
                      </small>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {seasonDetails(game, detail.round, detail.artist).length === 0 && (
            <p className="cheat-help">本季尚无已成交或季末未成交的作品。</p>
          )}
        </section>
      )}
      {tab === 'seasons' && (
        <section>
          <div className="cheat-round-heading">
            <h3>各季买入作品</h3>
            <label>
              查看{' '}
              <select
                aria-label="查看拍卖季"
                value={round}
                onChange={(e) => setRound(Number(e.target.value))}
              >
                {Array.from({ length: game.round }, (_, i) => i + 1).map(
                  (r) => (
                    <option key={r} value={r}>
                      第 {r} 季{r === game.round ? '（本季）' : ''}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <p className="cheat-help">
            含自购和免费取得的作品；触发季末而未成交的牌不计入。双重拍卖逐张列出。
          </p>
          <div className="cheat-collections">
            {data.players.map((p) => (
              <article key={p.id}>
                <h4>
                  {p.name}
                  <span>
                    {p.bought.length} 张
                    {p.settlement !== undefined
                      ? ` · 本季结算 ${p.settlement} 千元`
                      : ''}
                  </span>
                </h4>
                {p.bought.length ? (
                  <div className="cheat-cards">
                    {p.bought.map((c) => (
                      <div
                        className="cheat-card"
                        key={c.id}
                        style={
                          {
                            '--artist': ARTISTS[c.artist].color,
                          } as CSSProperties
                        }
                      >
                        <Artwork card={c} />
                        <div>
                          <strong>{ARTISTS[c.artist].name}</strong>
                          <span>{title(c)}</span>
                          <small>
                            {TYPES[c.type].icon} {TYPES[c.type].name}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="cheat-help">本季尚无买入作品</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
