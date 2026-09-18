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
} from 'lucide-react';
import { ARTISTS, makeDeck, title, TYPES } from './game/data.ts';
import { actor, applyAction, createGame, observe } from './game/engine.ts';
import { chooseAction as fallbackAction } from './game/ai-legacy.ts';
import { deserialize, SAVE_KEY, serialize } from './game/storage.ts';
import type { Action, Card, GameState } from './game/types.ts';
import { Replay } from './components/Replay.tsx';
import { Rules } from './components/Rules.tsx';
import { SaveSlots } from './components/SaveSlots.tsx';
import { seasonFinance } from './game/experience.ts';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  parsePreferences,
  makeLevelConfig,
  LEVELS,
} from './game/preferences.ts';
import type { GameLevel } from './game/preferences.ts';
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
          'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), a[href], summary',
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
  const finance = seasonFinance(game, r.round, 0);
  const ended = game.phase === 'finished';
  const myCash = game.players[0].cash;
  const rankOf = (amount: number) =>
    1 + game.players.filter((p) => p.cash > amount).length;
  const rankLabel = (amount: number) =>
    `${game.players.filter((p) => p.cash === amount).length > 1 ? '并列' : ''}第 ${rankOf(amount)} 名`;
  const myRank = rankOf(myCash);
  return (
    <div className="round-summary">
      <span className="eyebrow">
        {ended ? 'THE FINAL COLLECTION' : 'SEASON CLOSED'}
      </span>
      <h2>
        {ended ? `你获得${rankLabel(myCash)}` : `第 ${r.round} 季 · 结算`}
      </h2>
      {ended && (
        <p className="final-standing">
          {myRank === 1 ? '恭喜获胜！' : '四季拍卖结束'}
          {' · '}最终财富 <strong>{myCash} 千元</strong>
          {' · '}共 {game.players.length} 位玩家
        </p>
      )}
      <div className="season-end-notice" role="status">
        <strong>季末原因</strong>
        <p>{r.reason}</p>
      </div>
      <div className="result-prices">
        {ARTISTS.map((a, i) => (
          <div key={a.name}>
            <i style={{ background: a.color }} />
            {a.name}
            <strong>{r.values[i]}</strong>
          </div>
        ))}
      </div>
      <div className="settlement-holdings">
        <h3>结算前各馆藏品</h3>
        <p className="small muted">
          按艺术家统计本季已购作品；上方保留对应画作，进入下一季后清空展示。
        </p>
        <div className="table-scroll">
          <table
            className="settlement-table"
            aria-label="结算前各馆各艺术家藏品数量"
          >
            <thead>
              <tr>
                {ended && <th scope="col">最终名次</th>}
                <th scope="col">美术馆</th>
                {ARTISTS.map((a) => (
                  <th scope="col" key={a.name}>
                    <span style={{ color: a.color }}>●</span> {a.name}
                  </th>
                ))}
                <th scope="col">合计</th>
                <th scope="col">清算收入</th>
                <th scope="col">现金</th>
              </tr>
            </thead>
            <tbody>
              {[...game.players]
                .sort((a, b) => (ended ? b.cash - a.cash : a.id - b.id))
                .map((p) => (
                  <tr
                    key={p.id}
                    className={
                      ended && p.id === 0 ? 'your-standing' : undefined
                    }
                  >
                    {ended && (
                      <td>
                        <strong>{rankLabel(p.cash)}</strong>
                      </td>
                    )}
                    <th scope="row">{p.name}</th>
                    {ARTISTS.map((a, artist) => (
                      <td key={a.name}>
                        {r.sold[p.id].filter((c) => c.artist === artist).length}
                      </td>
                    ))}
                    <td>{r.sold[p.id].length} 幅</td>
                    <td>+{r.income[p.id]}</td>
                    <td>
                      {ended || cheatMode || p.id === 0
                        ? `${cheatMode ? cash[p.id] : p.cash} 千元`
                        : '现金保密'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {r.unsold.length > 0 && (
        <div className="settlement-unsold">
          <strong>季末未成交 · {r.unsold.length} 幅</strong>
          <p>计入艺术家数量排名，不属于任何馆的藏品，也不产生清算收入。</p>
          <div>
            {r.unsold.map((c) => (
              <figure key={c.id}>
                <Artwork card={c} />
                <figcaption>
                  {ARTISTS[c.artist].name} · {title(c)}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      <div className="finance-summary">
        <strong>你的第 {r.round} 季账目（千元）</strong>
        <div>
          <span>
            卖画收入 <b>+{finance.sales}</b>
          </span>
          <span>
            买画支出 <b>−{finance.purchases}</b>
          </span>
          <span>
            藏品清算 <b>+{finance.settlement}</b>
          </span>
          <span>
            现金净增{' '}
            <b>
              {finance.net >= 0 ? '+' : ''}
              {finance.net}
            </b>
          </span>
        </div>
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
    'rules' | 'new' | 'log' | 'cheats' | 'replay' | 'slots' | null
  >(null);
  const [cheatMode, setCheatMode] = useState(false);
  const cash = game && cheatMode ? publicBalances(game) : [];
  const [preferences] = useState(() => {
    try {
      return parsePreferences(localStorage.getItem(PREFERENCES_KEY));
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });
  const saleMode = DEFAULT_PREFERENCES.saleMode;
  const hints = DEFAULT_PREFERENCES.hints;
  const [level, setLevel] = useState<GameLevel>(
    preferences.level ?? 'beginner',
  );
  const [reviewSale, setReviewSale] = useState<SaleNotice | null>(null);
  const [sale, setSale] = useState<SaleNotice | null>(null);
  const [count, setCount] = useState(4);
  const speed = DEFAULT_PREFERENCES.speed;
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('1');
  const [filter, setFilter] = useState<number | null>(null);
  const [error, setError] = useState(initial.error);
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ speed, saleMode, hints, level }),
      );
    } catch {
      setError('设置无法保存；本次会话仍可使用。');
    }
  }, [speed, saleMode, hints, level]);
  function loadGame(next: GameState) {
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
  }
  function rematch() {
    if (!game) return;
    try {
      localStorage.setItem('modern-art.slot.backup', serialize(game));
      const next = createGame(game.players.length, game.seed, game.first);
      if (game.aiConfig) next.aiConfig = structuredClone(game.aiConfig);
      loadGame(next);
    } catch {
      setError('无法备份当前对局，未开始重赛。请先导出存档。');
    }
  }
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
        worker.postMessage({ observation, config: game.aiConfig });
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
    const next = createGame(count, seed, seed % count);
    next.aiConfig = makeLevelConfig(count, level);
    setGame(next);
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
  const minimum =
    auction?.type === 'sealed' || game?.phase === 'price'
      ? 0
      : (auction?.high ?? 0) + 1;
  const amountError =
    amount.trim() === ''
      ? '请输入金额'
      : !Number.isSafeInteger(Number(amount))
        ? '请输入整数千元'
        : Number(amount) < minimum
          ? `最低 ${minimum} 千元`
          : Number(amount) > (me?.cash ?? 0)
            ? '现金不足，不能透支'
            : '';
  const hint =
    game?.phase === 'pair'
      ? '同艺术家的非双重牌才能补画；他人补画后接任卖家并收取全部成交款。'
      : game?.phase === 'price'
        ? '无人购买时，你会按此价格向银行付款并取得作品。'
        : game?.phase === 'offer'
          ? '卡面符号决定拍卖方式。某艺术家第五幅亮相时立即结算，该拍品不成交。'
          : auction?.type === 'sealed'
            ? '报价锁定后不能修改；0 表示不报价，全部锁定后才揭晓。'
            : auction?.type === 'once'
              ? '只有一次报价机会，卖家最后行动。'
              : auction?.type === 'fixed'
                ? '按顺时针询问购买；全部放弃后由卖家自购。'
                : '暂不加价后，有人加价时你仍可再次参与。';
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
            <>
              <button
                className="text-button"
                onClick={() => setDialog('slots')}
              >
                存档
              </button>
              <button className="text-button" onClick={() => setScreen('menu')}>
                <ArrowLeft size={16} />
                返回主页
              </button>
            </>
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
            <div className="home-designer">
              <span>《现代艺术》原作游戏设计</span>
              <a href="https://www.knizia.de/" target="_blank" rel="noreferrer">
                Reiner Knizia
              </a>
            </div>
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
            <div className="home-tools">
              <button
                className="text-button"
                onClick={() => setDialog('rules')}
              >
                玩法指南
              </button>
              <button
                className="text-button"
                onClick={() => setDialog('slots')}
              >
                存档管理
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
                  <h2>
                    {game.phase === 'roundEnd' || game.phase === 'finished'
                      ? '结算前的桌面藏品'
                      : '收藏家与本季藏品'}
                  </h2>
                </div>
                <span className="small muted">按座次顺时针 · 画作逐张陈列</span>
              </div>
              <div
                className="collectors-grid"
                style={{ '--players': game.players.length } as CSSProperties}
              >
                {game.players.map((p) => {
                  const seller = auction?.seller === p.id;
                  const settled =
                    game.phase === 'roundEnd' || game.phase === 'finished';
                  const collection = settled
                    ? game.history.at(-1)!.sold[p.id]
                    : p.collection;
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
                        {collection.map((c) => (
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
                        {!collection.length && (
                          <p>{settled ? '本季没有购入作品' : '尚未购入作品'}</p>
                        )}
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
                          {auction.type !== 'sealed' &&
                          auction.type !== 'fixed' &&
                          auction.bidder !== null ? (
                            <div
                              className={`bid-leader ${auction.bidder === 0 ? 'is-you' : ''}`}
                              role="status"
                              aria-live="polite"
                            >
                              <span>
                                {auction.bidder === 0
                                  ? '你当前领先'
                                  : '当前最高出价者'}
                              </span>
                              <b>{game.players[auction.bidder].name}</b>
                            </div>
                          ) : (
                            <span>
                              {auction.type === 'sealed'
                                ? '所有报价锁定后一起揭晓'
                                : auction.type === 'fixed'
                                  ? '等待买家接受定价'
                                  : '尚无人出价'}
                            </span>
                          )}
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
                          <div className="bid-entry">
                            <div className="bid-entry-top">
                              <label className="amount-input">
                                <input
                                  aria-label={
                                    game.phase === 'price'
                                      ? '设定价格'
                                      : '出价金额'
                                  }
                                  aria-describedby="amount-feedback"
                                  aria-invalid={Boolean(amountError)}
                                  inputMode="numeric"
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
                              <div className="quick-bids">
                                <button
                                  className="secondary"
                                  disabled={minimum > me!.cash}
                                  onClick={() => setAmount(String(minimum))}
                                >
                                  {minimum === 0 ? '归零' : '最低加价'}
                                </button>
                                {[5, 10].map((delta) => (
                                  <button
                                    className="secondary"
                                    key={delta}
                                    disabled={
                                      Math.max(minimum, Number(amount) || 0) +
                                        delta >
                                      me!.cash
                                    }
                                    onClick={() =>
                                      setAmount(
                                        String(
                                          Math.max(
                                            minimum,
                                            Number(amount) || 0,
                                          ) + delta,
                                        ),
                                      )
                                    }
                                  >
                                    +{delta}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <small
                              id="amount-feedback"
                              className={amountError ? 'amount-error' : ''}
                              role="status"
                            >
                              {amountError ||
                                `若成交，剩余 ${me!.cash - Number(amount)} 千元${game.phase === 'price' ? '（自购时）' : ''}`}
                            </small>
                          </div>
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
                  <>
                    <button
                      className="secondary"
                      onClick={() => setDialog('replay')}
                    >
                      赛后复盘
                    </button>
                    <button className="secondary" onClick={rematch}>
                      同一发牌再挑战
                    </button>
                  </>
                )}
                {game.phase === 'finished' && (
                  <button className="primary" onClick={() => setDialog('new')}>
                    再开一局
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
              {hints &&
                game.phase !== 'finished' &&
                game.phase !== 'roundEnd' && (
                  <div className="context-hint">
                    <BookOpen size={13} />
                    <span>{hint}</span>
                    <button
                      className="text-button"
                      onClick={() => setDialog('rules')}
                    >
                      查规则
                    </button>
                  </div>
                )}
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
              cheats: '记牌面板',
              replay: '赛后复盘',
              slots: '存档管理',
            }[dialog]
          }
          close={() => setDialog(null)}
        >
          {dialog === 'rules' && (
            <Rules
              currentAuction={
                screen === 'game' ? game?.auction?.type : undefined
              }
            />
          )}
          {dialog === 'replay' && game?.phase === 'finished' && (
            <Replay game={game} />
          )}
          {dialog === 'slots' && (
            <>
              <SaveSlots game={game} load={loadGame} />
              <div className="home-buttons">
                {game && (
                  <button className="secondary" onClick={exportSave}>
                    <Download size={17} />
                    导出当前存档
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => fileRef.current?.click()}
                >
                  导入存档
                </button>
              </div>
            </>
          )}
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
              <div className="ai-options">
                <label>
                  对手难度
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as GameLevel)}
                  >
                    {Object.entries(LEVELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="small muted">
                {
                  {
                    beginner:
                      '正常估价和竞买，判断偶有偏差，主要考虑眼前收益。',
                    medium: '稳定估价，会考虑藏品和当前行情。',
                    hard: '关键阶段会推演出牌，关注对手收益与终季时机。',
                    expert: '每次选画都进行场景推演，更连贯地规划整季。',
                  }[level]
                }
              </p>
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
            if (game)
              localStorage.setItem('modern-art.slot.backup', serialize(game));
            loadGame(next);
          } catch (err) {
            setError(`导入失败：${(err as Error).message}`);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
