import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Gavel,
  Pause,
  Play,
  RotateCcw,
  X,
  Menu,
  Volume2,
} from 'lucide-react';
import { ARTISTS, makeDeck, title, TYPES } from './game/data.ts';
import { actor, applyAction, createGame, observe } from './game/engine.ts';
import { chooseAction as fallbackAction } from './game/ai-legacy.ts';
import { deserialize, SAVE_KEY, serialize } from './game/storage.ts';
import type { Action, Card, GameState } from './game/types.ts';
import { Artwork } from './components/Artwork.tsx';
import { CheatPanel } from './components/CheatPanel.tsx';
import { SaleAnnouncement } from './components/SaleAnnouncement.tsx';
import { publicBalances } from './game/inspection.ts';
import { completedSale, requiresSaleConfirmation } from './game/sale.ts';
import type { SaleNotice } from './game/sale.ts';
function readSave(): { game: GameState | null; error: string } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return { game: raw ? deserialize(raw) : null, error: '' };
  } catch {
    return {
      game: null,
      error: '无法读取存档，原始数据仍保留。你可以导入备份，或开始新局。',
    };
  }
}
function Modal({
  title: heading,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button, input, select, a[href]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-scrim" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h2>{heading}</h2>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Rules() {
  return (
    <div className="rules">
      <p>
        经营一间美术馆，买入与卖出作品。四季结束后，现金最多的玩家获胜。金额单位均为千元。
      </p>
      <h3>出画 → 拍卖 → 收藏 → 季末出售</h3>
      <p>
        轮到你出画时，从手牌选择一幅作品。卡上的符号决定拍卖方式。买家向拍卖师付款；拍卖师买自己的画时向银行付款。
      </p>
      {Object.values(TYPES).map((t) => (
        <p key={t.name}>
          <strong>
            {t.icon} {t.name}
          </strong>
          <br />
          {t.help}
        </p>
      ))}
      <h3>第五幅出现，立即结束本季</h3>
      <p>
        某位艺术家的第五幅作品亮相时不拍卖，直接结算。双重拍卖的第二幅触发时，两幅均不成交，但都计入出画数量。
      </p>
      <p>
        按出画数量排名，前三名分别增加 30 / 20 /
        10。数量相同时，行情板从左到右优先。只有本季前三名的作品有价值，其售价为该艺术家历季价格之和；其余作品本季价值为零。
      </p>
      <p>
        所有已购作品在季末出售并弃置；未出的手牌保留。第四季不再补牌。若所有玩家的手牌提前耗尽，最后拍品不成交，结算后结束游戏。
      </p>
      <h3>网页版操作</h3>
      <p>
        公开竞价依次询问加价意愿。暂不跟价不会永久退出，有人加价后你仍能参与。选画、定价、报价都需要点击确认；提交后不提供撤回。对手现金、手牌和未揭晓的暗标保持隐藏。
      </p>
      <p className="muted">
        原创画作与艺术家名称；不含三人局“神秘玩家”可选变体。
      </p>
      <a
        href="https://www.cmon.com/wp-content/uploads/2023/06/MA_Rulebbok_Artbook_v18-low.pdf"
        target="_blank"
        rel="noreferrer"
      >
        查看官方规则书 ↗
      </a>
    </div>
  );
}
function PaintingCard({
  card,
  selected,
  onClick,
  disabled = false,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`painting-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={`选择 ${ARTISTS[card.artist].name} ${title(card)} ${TYPES[card.type].name}`}
      aria-pressed={selected}
      style={
        {
          '--artist': ARTISTS[card.artist].color,
          '--artist-paper': ARTISTS[card.artist].paper,
        } as CSSProperties
      }
    >
      <div className="card-artist">
        <strong>{ARTISTS[card.artist].name}</strong>
        <span>{ARTISTS[card.artist].en}</span>
      </div>
      <div className="card-image">
        <Artwork card={card} />
        <span className="auction-symbol" title={TYPES[card.type].name}>
          {TYPES[card.type].icon}
        </span>
      </div>
      <div className="card-caption">
        <strong>{title(card)}</strong>
        <span>
          <i style={{ background: ARTISTS[card.artist].color }} />
          {ARTISTS[card.artist].name} · {TYPES[card.type].name}
        </span>
      </div>
    </button>
  );
}
function Market({ game }: { game: GameState }) {
  return (
    <section className="market">
      <div className="section-head">
        <div>
          <span className="eyebrow">THE ART MARKET</span>
          <h2>历季定价</h2>
        </div>
        <span className="muted small">同量时，从上到下优先</span>
      </div>
      <table className="pricing-table" aria-label="艺术家历季结算价格">
        <thead>
          <tr>
            <th scope="col">艺术家</th>
            {[1, 2, 3, 4].map((r) => (
              <th
                scope="col"
                key={r}
                className={r === game.round ? 'current' : ''}
              >
                {r} 季
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ARTISTS.map((a, i) => (
            <tr key={a.name} style={{ '--artist': a.color } as CSSProperties}>
              <th scope="row">
                <span>{a.name}</span>
              </th>
              {[1, 2, 3, 4].map((r) => (
                <td key={r} className={r === game.round ? 'current' : ''}>
                  {game.history.find((h) => h.round === r)?.awards[i] || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="market-note">
        仅记录已结算的价格 · 本季出画数量与排名请根据桌面作品自行判断
      </p>
    </section>
  );
}
function RoundSummary({
  game,
  send,
  cheatMode,
}: {
  game: GameState;
  cheatMode: boolean;
  send: (a: Action) => void;
}) {
  const cash = cheatMode ? publicBalances(game) : [];
  const r = game.history.at(-1)!;
  const ended = game.phase === 'finished';
  const max = Math.max(...game.players.map((p) => p.cash));
  return (
    <div className="round-summary">
      <span className="eyebrow">
        {ended ? 'THE FINAL COLLECTION' : 'SEASON CLOSED'}
      </span>
      <h2>{ended ? '拍卖落幕' : `第 ${r.round} 季 · 结算`}</h2>
      <p>
        {ended
          ? `${game.players
              .filter((p) => p.cash === max)
              .map((p) => p.name)
              .join(
                '、',
              )} ${game.players.filter((p) => p.cash === max).length > 1 ? '并列获胜' : '获胜'}`
          : r.reason}
      </p>
      <div className="result-prices">
        {ARTISTS.map((a, i) => (
          <div key={a.name}>
            <i style={{ background: a.color }} />
            {a.name}
            <strong>{r.values[i]}</strong>
          </div>
        ))}
      </div>
      <div className="result-table">
        {[...game.players]
          .sort((a, b) => (ended ? b.cash - a.cash : a.id - b.id))
          .map((p) => (
            <div key={p.id}>
              <span>{p.name}</span>
              <span>
                {r.sold[p.id].length} 幅 · 本季 +{r.income[p.id]}
              </span>
              <strong>
                {ended || cheatMode || p.id === 0
                  ? `${cheatMode ? cash[p.id] : p.cash} 千元`
                  : '现金保密'}
              </strong>
            </div>
          ))}
      </div>
      {!ended && (
        <button className="primary" onClick={() => send({ type: 'next' })}>
          {game.round === 4 || game.players.every((p) => !p.hand.length)
            ? '揭晓最终财富'
            : '进入下一季'}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
export default function App() {
  const [initial] = useState(readSave);
  const [game, setGame] = useState<GameState | null>(initial.game);
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [dialog, setDialog] = useState<
    'rules' | 'new' | 'log' | 'settings' | 'cheats' | null
  >(null);
  const [cheatMode, setCheatMode] = useState(false);
  const cash = game && cheatMode ? publicBalances(game) : [];
  const [saleMode, setSaleMode] = useState<'brief' | 'confirm'>('brief');
  const [reviewSale, setReviewSale] = useState<SaleNotice | null>(null);
  const [sale, setSale] = useState<SaleNotice | null>(null);
  const [count, setCount] = useState(4);
  const [speed, setSpeed] = useState(850);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('1');
  const [filter, setFilter] = useState<number | null>(null);
  const [error, setError] = useState(initial.error);
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  function send(action: Action) {
    if (!game) return;
    try {
      const next = applyAction(game, action);
      setSale(completedSale(game, next));
      setGame(next);
      setSelected(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!game) return;
    // Only write a loaded or newly-created, valid game. A corrupt save is never silently deleted.
    try {
      localStorage.setItem(SAVE_KEY, serialize(game));
      setSaveError('');
    } catch {
      setSaveError('自动存档失败，请导出存档保留进度。');
    }
  }, [game]);
  const current = game ? actor(game) : null;
  useEffect(() => {
    if (
      !game ||
      screen !== 'game' ||
      paused ||
      dialog ||
      sale ||
      reviewSale ||
      current === null ||
      current === 0
    )
      return;
    let worker: Worker | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    const observation = observe(game, current);
    const finish = (action?: Action) => {
      if (completed) return;
      completed = true;
      clearTimeout(watchdog);
      worker?.terminate();
      if (!action)
        console.warn(
          'AI worker unavailable or timed out; using legacy fallback',
        );
      try {
        const next = applyAction(game, action ?? fallbackAction(observation));
        setSale(completedSale(game, next));
        setGame(next);
      } catch (e) {
        setPaused(true);
        setError(`AI 暂停：${(e as Error).message}`);
      }
    };
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./game/ai.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (
          event: MessageEvent<{ action?: Action; error?: string }>,
        ) => finish(event.data.action);
        worker.onerror = () => finish();
        watchdog = setTimeout(() => finish(), 3000);
        worker.postMessage(observation);
      } catch {
        finish();
      }
    }, speed);
    return () => {
      completed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      worker?.terminate();
    };
  }, [game, screen, paused, dialog, current, speed, sale, reviewSale]);
  useEffect(() => {
    if (
      !sale ||
      requiresSaleConfirmation(sale, saleMode) ||
      screen !== 'game' ||
      dialog ||
      paused
    )
      return;
    const timer = setTimeout(() => setSale(null), 2000);
    return () => clearTimeout(timer);
  }, [sale, saleMode, screen, dialog, paused]);
  useEffect(() => {
    setAmount(
      String(
        game?.phase === 'price'
          ? 10
          : game?.auction?.type === 'sealed'
            ? 0
            : (game?.auction?.high ?? 0) + 1,
      ),
    );
  }, [
    game?.actions.length,
    game?.phase,
    game?.auction?.high,
    game?.auction?.type,
  ]);
  function start() {
    setReviewSale(null);
    setSale(null);
    setCheatMode(false);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    setGame(createGame(count, seed, seed % count));
    setScreen('game');
    setDialog(null);
    setSelected(null);
    setFilter(null);
    setPaused(false);
    setError('');
  }
  function exportSave() {
    if (!game) return;
    const url = URL.createObjectURL(
      new Blob([serialize(game)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '现代艺术-存档.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const lastTransaction = game?.transactions.at(-1);
  const lastSale: SaleNotice | null =
    game && lastTransaction
      ? {
          buyer: game.players[lastTransaction.buyer],
          seller: game.players[lastTransaction.seller],
          amount: lastTransaction.amount,
          cards: lastTransaction.cards,
        }
      : null;
  const me = game?.players[0],
    auction = game?.auction,
    chosen = me?.hand.find((c) => c.id === selected);
  const myTurn = current === 0,
    actionable = myTurn && !paused;
  const validAmount =
    amount.trim() !== '' &&
    Number.isSafeInteger(Number(amount)) &&
    Number(amount) >= 0 &&
    Number(amount) <= (me?.cash ?? 0);
  const canBid =
    validAmount &&
    (auction?.type === 'sealed' ||
      game?.phase === 'price' ||
      Number(amount) > (auction?.high ?? 0));
  const canSelect = (c: Card) =>
    actionable &&
    (game?.phase === 'offer' ||
      (game?.phase === 'pair' &&
        c.artist === auction?.cards[0].artist &&
        c.type !== 'double'));
  return (
    <div className={`app ${screen === 'menu' ? 'on-menu' : ''}`}>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            setScreen('menu');
            setDialog(null);
          }}
        >
          <span className="brand-mark">
            m<span>a</span>
          </span>
          <span>
            现代艺术<small>MODERN ART</small>
          </span>
        </button>
        <nav>
          {screen === 'game' && game && (
            <span className="season-pill">第 {game.round} / 4 季</span>
          )}
          <button
            className="text-button"
            aria-label="玩法指南"
            onClick={() => setDialog('rules')}
          >
            <BookOpen size={16} />
            <span>玩法指南</span>
          </button>
          {screen === 'game' && game && (
            <button
              className={`text-button cheat-toggle ${cheatMode ? 'enabled' : ''}`}
              aria-pressed={cheatMode}
              onClick={() => {
                setCheatMode(true);
                setDialog('cheats');
              }}
            >
              {cheatMode ? '记牌：已开启' : '记牌辅助'}
            </button>
          )}
          {screen === 'game' && (
            <button
              className="icon-button"
              onClick={() => setDialog('settings')}
              aria-label="对局菜单"
            >
              <Menu size={21} />
            </button>
          )}
        </nav>
      </header>
      {(error || saveError) && (
        <div className="notice" role="alert">
          {error || saveError}
          <button
            onClick={() => {
              setError('');
              setSaveError('');
            }}
            aria-label="关闭提示"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {screen === 'menu' ? (
        <main className="home">
          <div className="home-copy">
            <span className="eyebrow">THE ART OF THE AUCTION</span>
            <h1>
              价格由你举牌。
              <br />
              价值由市场决定。
            </h1>
            <p>
              五位艺术家，四个拍卖季。
              <br />
              在收藏与交易之间，经营你的美术馆。
            </p>
            <div className="home-buttons">
              {game && (
                <button
                  className="primary"
                  onClick={() => {
                    setScreen('game');
                    setPaused(false);
                  }}
                >
                  {game.phase === 'finished' ? '查看上局结果' : '继续拍卖'}
                  <ArrowRight size={18} />
                </button>
              )}
              <button
                className={game ? 'secondary' : 'primary'}
                onClick={() => setDialog('new')}
              >
                {game ? '开始新的一局' : '进入拍卖厅'}
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="home-meta">
              <span>3—5 人</span>
              <span>本地 AI 对战</span>
              <span>完整四季</span>
            </div>
            <button
              className="text-button import-link"
              onClick={() => fileRef.current?.click()}
            >
              导入已有存档
            </button>
          </div>
          <div className="home-gallery">
            {[0, 1, 4].map((artist, i) => (
              <div className={`hero-work hero-work-${i}`} key={artist}>
                <Artwork
                  card={makeDeck().find(
                    (c) => c.artist === artist && c.index === i + 2,
                  )!}
                />
                <span>
                  {ARTISTS[artist].en} — STUDY NO. {i + 3}
                </span>
              </div>
            ))}
            <div className="gallery-caption">
              <span>FIVE ARTISTS · FIFTEEN PAINTINGS</span>
              <span>原创油画作品系列</span>
            </div>
          </div>
        </main>
      ) : (
        game && (
          <main className="game-layout">
            <section className="collectors-table">
              <div className="section-head">
                <div>
                  <span className="eyebrow">AROUND THE TABLE</span>
                  <h2>收藏家与本季藏品</h2>
                </div>
                <span className="small muted">按座次顺时针 · 画作逐张陈列</span>
              </div>
              <div
                className="collectors-grid"
                style={{ '--players': game.players.length } as CSSProperties}
              >
                {game.players.map((p) => {
                  const seller = auction?.seller === p.id;
                  return (
                    <article
                      key={p.id}
                      className={`collector-seat ${seller ? 'is-seller' : ''} ${current === p.id ? 'is-acting' : ''}`}
                    >
                      <div className="collector-identity">
                        <div className="player-avatar">
                          {['昼', '圆', '岸', '屿', '界'][p.id]}
                        </div>
                        <div>
                          <small>
                            席位 {String(p.id + 1).padStart(2, '0')}
                          </small>
                          <h3>{p.name}</h3>
                        </div>
                      </div>
                      <div className="seat-roles">
                        {seller && (
                          <span className="seller-badge">
                            <Gavel size={13} />
                            本场卖家
                          </span>
                        )}
                        {current === p.id && (
                          <span className="acting-badge">
                            {game.phase === 'offer'
                              ? '正在选画'
                              : game.phase === 'pair'
                                ? '正在补画'
                                : '正在出价'}
                          </span>
                        )}
                      </div>
                      <div className="seat-meta">
                        <span>待拍手牌 {p.hand.length}</span>
                        <span>
                          {cheatMode || p.id === 0 || game.phase === 'finished'
                            ? `${cheatMode ? cash[p.id] : p.cash} 千元`
                            : '现金保密'}
                        </span>
                      </div>
                      <div
                        className="collected-works"
                        aria-label={`${p.name} 的本季藏品`}
                      >
                        {p.collection.map((c) => (
                          <div
                            className="collected-work"
                            key={c.id}
                            style={
                              {
                                '--artist': ARTISTS[c.artist].color,
                              } as CSSProperties
                            }
                            title={`${ARTISTS[c.artist].name}《${title(c)}》`}
                          >
                            <Artwork card={c} />
                            <span>{ARTISTS[c.artist].name}</span>
                          </div>
                        ))}
                        {!p.collection.length && <p>尚未购入作品</p>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <div className="main-column">
              <section className="auction-room">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">LIVE AUCTION</span>
                    <h2>
                      {game.phase === 'roundEnd' || game.phase === 'finished'
                        ? '季末展览'
                        : '中央拍卖台'}
                    </h2>
                  </div>
                  <div className={`live-status ${paused ? 'is-paused' : ''}`}>
                    <i />
                    {paused
                      ? '已暂停'
                      : myTurn
                        ? '等待你的决定'
                        : current !== null
                          ? '拍卖进行中'
                          : '本季已结算'}
                  </div>
                </div>
                {game.phase === 'roundEnd' || game.phase === 'finished' ? (
                  <RoundSummary game={game} send={send} cheatMode={cheatMode} />
                ) : (
                  <div className="auction-stage">
                    <div
                      className={`lot-display ${auction?.cards.length === 2 ? 'double-lot' : ''}`}
                    >
                      {auction ? (
                        auction.cards.map((c) => (
                          <div
                            className="framed-work"
                            key={c.id}
                            style={
                              {
                                '--artist': ARTISTS[c.artist].color,
                              } as CSSProperties
                            }
                          >
                            <Artwork card={c} />
                            <div className="work-label">
                              <span>{ARTISTS[c.artist].name}</span>
                              <strong>{title(c)}</strong>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-lot">
                          <Gavel strokeWidth={1} size={42} />
                          <h3>
                            {myTurn
                              ? '下一件作品，由你揭幕'
                              : '下一件作品即将亮相'}
                          </h3>
                          <p>
                            {myTurn
                              ? '从下方手牌中选择一幅画，开始拍卖。'
                              : `${game.players[current ?? game.turn].name} 正在挑选作品`}
                          </p>
                          <span>每一次出画，都在改变市场。</span>
                        </div>
                      )}
                    </div>
                    {auction && (
                      <div className="lot-info">
                        <div className="seller-banner">
                          <Gavel size={19} />
                          <div>
                            <span>本场卖家 / 拍卖师</span>
                            <strong>{game.players[auction.seller].name}</strong>
                            <small>成交款支付给卖家；卖家自购则支付银行</small>
                          </div>
                        </div>
                        <span className="lot-tag">
                          {TYPES[auction.type].icon} {TYPES[auction.type].name}
                          {auction.cards.length === 2 ? ' · 双幅作品' : ''}
                        </span>
                        <h3>
                          {ARTISTS[auction.cards[0].artist].name}
                          <small>
                            {ARTISTS[auction.cards[0].artist].style}
                          </small>
                        </h3>
                        <p>{TYPES[auction.type].help}</p>
                        <div className="bid-price">
                          <span>
                            {auction.type === 'sealed'
                              ? '秘密竞价'
                              : auction.type === 'fixed'
                                ? '一口价'
                                : '当前最高报价'}
                          </span>
                          <strong>
                            {auction.type === 'sealed'
                              ? '•••'
                              : auction.type === 'fixed'
                                ? (auction.price ?? '待定')
                                : auction.high}
                            <small>
                              {auction.type !== 'sealed' ? '千元' : ''}
                            </small>
                          </strong>
                          <span>
                            {auction.type === 'sealed'
                              ? '所有报价锁定后一起揭晓'
                              : auction.bidder !== null
                                ? game.players[auction.bidder].name
                                : `拍卖师 · ${game.players[auction.seller].name}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
              <section className="hand-section">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">YOUR PRIVATE COLLECTION</span>
                    <h2>
                      待拍作品{' '}
                      <span className="number-badge">{me!.hand.length}</span>
                    </h2>
                  </div>
                  <div className="filters">
                    <button
                      className={filter === null ? 'active' : ''}
                      onClick={() => setFilter(null)}
                    >
                      全部
                    </button>
                    {ARTISTS.map((a, i) => (
                      <button
                        key={a.name}
                        title={a.name}
                        aria-label={`筛选 ${a.name}`}
                        aria-pressed={filter === i}
                        className={filter === i ? 'active' : ''}
                        onClick={() => setFilter(filter === i ? null : i)}
                      >
                        <i style={{ background: a.color }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hand-scroll">
                  {me!.hand
                    .filter((c) => filter === null || c.artist === filter)
                    .sort((a, b) => a.artist - b.artist || a.index - b.index)
                    .map((c) => (
                      <PaintingCard
                        key={c.id}
                        card={c}
                        selected={selected === c.id}
                        disabled={game.phase === 'pair' && !canSelect(c)}
                        onClick={() =>
                          setSelected(selected === c.id ? null : c.id)
                        }
                      />
                    ))}
                  {!me!.hand.length && (
                    <p className="empty-hand">
                      本季手牌已用尽，你仍可参与竞价。
                    </p>
                  )}
                  {me!.hand.length > 0 &&
                    !me!.hand.some(
                      (c) => filter === null || c.artist === filter,
                    ) && (
                      <p className="empty-hand">没有这位艺术家的待拍作品。</p>
                    )}
                </div>
                <p className="small muted hand-note">
                  {chosen
                    ? `已选《${title(chosen)}》 · ${TYPES[chosen.type].help}`
                    : '点击作品查看拍卖方式；手牌未出售前不计入你的藏品。'}
                </p>
              </section>
            </div>
            <aside className="sidebar">
              <Market game={game} />
              <section className="your-museum">
                <span className="eyebrow">YOUR MUSEUM</span>
                <h2>白昼美术馆</h2>
                <div className="balance">
                  <span>可用现金</span>
                  <strong>
                    {me!.cash}
                    <small>千元</small>
                  </strong>
                </div>
                <div className="museum-foot">
                  <span>{me!.collection.length} 幅本季藏品</span>
                  <span>席位 01</span>
                </div>
              </section>
              <section className="activity-panel">
                <div className="section-head">
                  <h2>拍卖纪事</h2>
                  <button
                    className="text-button small"
                    onClick={() => setDialog('log')}
                  >
                    全部 ↗
                  </button>
                </div>
                <div className="activity-list" aria-live="polite">
                  {game.log
                    .slice(-5)
                    .reverse()
                    .map((line, i) => (
                      <p key={`${game.log.length - i}`}>
                        <i />
                        {line}
                      </p>
                    ))}
                </div>
              </section>
              {lastSale && (
                <button
                  className="recent-sale"
                  onClick={() => setReviewSale(lastSale)}
                >
                  <small>最近成交 · 点击回看</small>
                  <strong>
                    {lastSale.buyer.name} · {lastSale.amount} 千元
                  </strong>
                  <span>{lastSale.cards.map((c) => title(c)).join('、')}</span>
                </button>
              )}
              <div className="save-status">
                <Check size={13} />
                {saveError ? '存档异常' : '进度自动保存于此浏览器'}
              </div>
            </aside>
            <div className="action-dock">
              <div className="action-prompt">
                <span className="eyebrow">
                  {paused ? 'PAUSED' : myTurn ? 'YOUR MOVE' : 'AT THE TABLE'}
                </span>
                <strong>
                  {paused
                    ? '对局已暂停'
                    : game.phase === 'finished'
                      ? '本场拍卖已结束'
                      : game.phase === 'roundEnd'
                        ? '查看本季结算后继续'
                        : myTurn
                          ? game.phase === 'offer'
                            ? '选择一幅作品送上拍卖台'
                            : game.phase === 'pair'
                              ? '搭配同一艺术家的第二幅作品'
                              : game.phase === 'price'
                                ? '为作品设定一口价'
                                : auction?.type === 'sealed'
                                  ? '锁定你的秘密报价'
                                  : auction?.type === 'fixed'
                                    ? '按一口价买下这件作品？'
                                    : '现在轮到你出价'
                          : `${game.players[current ?? game.turn].name} 正在${game.phase === 'offer' ? '选画' : game.phase === 'pair' ? '决定是否补画' : '考虑报价'}…`}
                </strong>
                {auction && (
                  <span className="dock-seller">
                    <Gavel size={12} />
                    卖家：{game.players[auction.seller].name}
                  </span>
                )}
              </div>
              <div className="action-controls">
                {paused ? (
                  <button className="primary" onClick={() => setPaused(false)}>
                    <Play size={16} />
                    继续拍卖
                  </button>
                ) : (
                  actionable && (
                    <>
                      {(game.phase === 'offer' || game.phase === 'pair') && (
                        <>
                          {game.phase === 'pair' && (
                            <button
                              className="secondary"
                              onClick={() =>
                                send({ type: 'pair', player: 0, card: null })
                              }
                            >
                              不补画
                            </button>
                          )}
                          <button
                            className="primary"
                            disabled={!chosen || !canSelect(chosen)}
                            onClick={() =>
                              chosen &&
                              send(
                                game.phase === 'offer'
                                  ? {
                                      type: 'offer',
                                      player: 0,
                                      card: chosen.id,
                                    }
                                  : {
                                      type: 'pair',
                                      player: 0,
                                      card: chosen.id,
                                    },
                              )
                            }
                          >
                            {game.phase === 'pair' ? '确认搭配' : '确认出画'}
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                      {(game.phase === 'price' ||
                        (game.phase === 'bid' &&
                          auction?.type !== 'fixed')) && (
                        <>
                          <label className="amount-input">
                            <input
                              aria-label={
                                game.phase === 'price' ? '设定价格' : '出价金额'
                              }
                              type="number"
                              min={
                                auction?.type === 'sealed' ||
                                game.phase === 'price'
                                  ? 0
                                  : (auction?.high ?? 0) + 1
                              }
                              max={me!.cash}
                              step="1"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                            />
                            <span>千元</span>
                          </label>
                          {game.phase === 'bid' &&
                            auction?.type !== 'sealed' && (
                              <button
                                className="secondary"
                                onClick={() =>
                                  send({ type: 'bid', player: 0, amount: null })
                                }
                              >
                                {auction?.type === 'open' ? '暂不加价' : '放弃'}
                              </button>
                            )}
                          <button
                            className="primary"
                            disabled={!canBid}
                            onClick={() =>
                              send(
                                game.phase === 'price'
                                  ? {
                                      type: 'price',
                                      player: 0,
                                      amount: Number(amount),
                                    }
                                  : {
                                      type: 'bid',
                                      player: 0,
                                      amount: Number(amount),
                                    },
                              )
                            }
                          >
                            {game.phase === 'price'
                              ? '确认定价'
                              : auction?.type === 'sealed'
                                ? '锁定暗标'
                                : '确认出价'}
                          </button>
                        </>
                      )}
                      {game.phase === 'bid' && auction?.type === 'fixed' && (
                        <>
                          <button
                            className="secondary"
                            onClick={() =>
                              send({ type: 'buy', player: 0, accept: false })
                            }
                          >
                            放弃购买
                          </button>
                          <button
                            className="primary"
                            disabled={auction.price! > me!.cash}
                            onClick={() =>
                              send({ type: 'buy', player: 0, accept: true })
                            }
                          >
                            {auction.price! > me!.cash
                              ? '现金不足'
                              : `支付 ${auction.price} 千元`}
                          </button>
                        </>
                      )}
                    </>
                  )
                )}
                {!paused && !myTurn && current !== null && (
                  <button className="secondary" onClick={() => setPaused(true)}>
                    <Pause size={16} />
                    暂停
                  </button>
                )}
                {game.phase === 'finished' && (
                  <button className="primary" onClick={() => setDialog('new')}>
                    再开一局
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
            </div>
          </main>
        )
      )}
      <footer className="app-footer">
        <span>MODERN ART · A GAME OF TASTE & TIMING</span>
        <span>艺术的价值，始于一次选择。</span>
      </footer>
      {screen === 'game' &&
        !dialog &&
        (reviewSale || (sale && requiresSaleConfirmation(sale, saleMode))) && (
          <Modal
            title="落槌成交"
            close={() => {
              setSale(null);
              setReviewSale(null);
            }}
          >
            <SaleAnnouncement
              sale={(reviewSale ?? sale)!}
              close={() => {
                setSale(null);
                setReviewSale(null);
              }}
            />
          </Modal>
        )}
      {sale &&
        !requiresSaleConfirmation(sale, saleMode) &&
        !reviewSale &&
        screen === 'game' &&
        !dialog && (
          <div className="sale-toast" role="status" aria-live="polite">
            <Artwork card={sale.cards[0]} />
            <div>
              <strong>
                {sale.buyer.name} ·{' '}
                {sale.amount === 0 ? '免费取得' : `${sale.amount} 千元成交`}
              </strong>
              <span>卖家：{sale.seller.name}</span>
              <span>
                {sale.cards.map((c) => title(c)).join('、')}
                {sale.cards.length === 2 ? '（两幅合计）' : ''}
              </span>
            </div>
            <button className="text-button" onClick={() => setReviewSale(sale)}>
              详情
            </button>
            <button
              className="text-button"
              onClick={() => setSale(null)}
              aria-label="关闭成交提醒"
            >
              关闭
            </button>
          </div>
        )}
      {dialog && (
        <Modal
          title={
            {
              rules: '拍卖指南',
              new: '开启新的拍卖季',
              log: '拍卖纪事',
              settings: '对局设置',
              cheats: '记牌面板',
            }[dialog]
          }
          close={() => setDialog(null)}
        >
          {dialog === 'rules' && <Rules />}
          {dialog === 'cheats' && game && cheatMode && (
            <CheatPanel
              game={game}
              disable={() => {
                setCheatMode(false);
                setDialog(null);
              }}
            />
          )}
          {dialog === 'new' && (
            <div className="new-game">
              <p>选择参加拍卖的美术馆数量，其余席位由本地 AI 控制。</p>
              <div className="count-options">
                {[3, 4, 5].map((n) => (
                  <button
                    className={count === n ? 'selected' : ''}
                    key={n}
                    onClick={() => setCount(n)}
                  >
                    <strong>{n} 人</strong>
                    <span>你 + {n - 1} 位 AI</span>
                  </button>
                ))}
              </div>
              <p className="small muted">
                随机先手 · 每馆 100 千元 · 四个拍卖季
              </p>
              {game && (
                <p className="small">
                  开始后将替换当前自动存档。
                  <button className="text-button" onClick={exportSave}>
                    导出当前存档
                  </button>
                </p>
              )}
              <button className="primary wide" onClick={start}>
                开始拍卖
                <ArrowRight size={18} />
              </button>
            </div>
          )}
          {dialog === 'log' && (
            <div className="full-log">
              {game?.log.map((l, i) => (
                <p key={i}>
                  <span>{String(i + 1).padStart(3, '0')}</span>
                  {l}
                </p>
              ))}
            </div>
          )}
          {dialog === 'settings' && (
            <div className="settings">
              <label>
                开启记牌辅助
                <input
                  type="checkbox"
                  checked={cheatMode}
                  onChange={(e) => setCheatMode(e.target.checked)}
                />
              </label>
              {cheatMode && (
                <button
                  className="secondary"
                  onClick={() => setDialog('cheats')}
                >
                  查看记牌面板
                </button>
              )}
              <label>
                成交提醒
                <select
                  value={saleMode}
                  onChange={(e) =>
                    setSaleMode(e.target.value as 'brief' | 'confirm')
                  }
                >
                  <option value="brief">简短提醒 · 一口价需确认</option>
                  <option value="confirm">弹框确认 · 手动继续</option>
                </select>
              </label>
              <label>
                <Volume2 size={18} />
                AI 行动节奏
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  <option value={1500}>从容 · 1.5 秒</option>
                  <option value={850}>标准 · 0.85 秒</option>
                  <option value={200}>快速 · 0.2 秒</option>
                </select>
              </label>
              <button
                className="secondary"
                onClick={() => {
                  setPaused(!paused);
                  setDialog(null);
                }}
              >
                {paused ? <Play size={17} /> : <Pause size={17} />}{' '}
                {paused ? '继续对局' : '暂停对局'}
              </button>
              <button className="secondary" onClick={exportSave}>
                <Download size={17} />
                导出存档
              </button>
              <button
                className="secondary"
                onClick={() => fileRef.current?.click()}
              >
                导入存档（替换本局）
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setDialog(null);
                  setScreen('menu');
                }}
              >
                <ArrowLeft size={17} />
                保存并返回主菜单
              </button>
            </div>
          )}
        </Modal>
      )}
      <input
        hidden
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 2_000_000) throw new Error('存档过大');
            const next = deserialize(await file.text());
            setSale(null);
            setReviewSale(null);
            setCheatMode(false);
            setGame(next);
            setSelected(null);
            setFilter(null);
            setPaused(false);
            setDialog(null);
            setScreen('game');
            setError('');
          } catch (err) {
            setError(`导入失败：${(err as Error).message}`);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
