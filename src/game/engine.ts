import { ARTISTS, DEALS, makeDeck, random, TYPES } from './data.ts';
import type {
  Action,
  AuctionType,
  Card,
  GameState,
  Observation,
} from './types.ts';
function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const clockwise = (start: number, n: number, length = n) =>
  Array.from({ length }, (_, i) => (start + i) % n);
export function createGame(
  count = 4,
  seed = Date.now() >>> 0,
  first = 0,
): GameState {
  requireRule([3, 4, 5].includes(count), '人数必须为 3–5 人');
  requireRule(
    Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff,
    '种子无效',
  );
  requireRule(
    Number.isInteger(first) && first >= 0 && first < count,
    '先手无效',
  );
  const deck = makeDeck(),
    rng = random(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const names = [
    '你 · 白昼美术馆',
    '方圆画廊',
    '海岸美术馆',
    '青屿艺术馆',
    '无界收藏馆',
  ];
  const s: GameState = {
    version: 1,
    seed,
    first,
    round: 1,
    turn: first,
    phase: 'offer',
    players: Array.from({ length: count }, (_, id) => ({
      id,
      name: names[id],
      cash: 100,
      hand: [],
      collection: [],
    })),
    deck,
    discarded: [],
    counts: [0, 0, 0, 0, 0],
    history: [],
    auction: null,
    log: ['第一季开幕。每间美术馆获得 100 千元。'],
    transactions: [],
    actions: [],
    bankFlow: 0,
  };
  deal(s);
  return s;
}
function deal(s: GameState) {
  for (let i = 0; i < DEALS[s.players.length][s.round - 1]; i++)
    for (const p of s.players) {
      const c = s.deck.pop();
      requireRule(c, '牌堆不足');
      p.hand.push(c);
    }
}
export function ranking(counts: number[]): number[] {
  return counts
    .map((_, i) => i)
    .filter((i) => counts[i] > 0)
    .sort((a, b) => counts[b] - counts[a] || a - b)
    .slice(0, 3);
}
export function currentValues(
  s: Pick<GameState, 'counts' | 'history'>,
): number[] {
  const top = ranking(s.counts);
  return s.counts.map((_, a) =>
    top.includes(a)
      ? 30 -
        top.indexOf(a) * 10 +
        s.history.reduce((sum, r) => sum + r.awards[a], 0)
      : 0,
  );
}
function endRound(s: GameState, reason: string) {
  const top = ranking(s.counts),
    awards = s.counts.map((_, a) =>
      top.includes(a) ? 30 - top.indexOf(a) * 10 : 0,
    ),
    values = currentValues(s);
  const sold = s.players.map((p) => [...p.collection]);
  const income = s.players.map((p) =>
    p.collection.reduce((sum, c) => sum + values[c.artist], 0),
  );
  s.history.push({
    round: s.round,
    counts: [...s.counts],
    awards,
    values,
    income,
    sold,
    unsold: [...(s.auction?.cards ?? [])],
    reason,
  });
  s.players.forEach((p, i) => {
    p.cash += income[i];
    s.bankFlow += income[i];
    s.discarded.push(...p.collection);
    p.collection = [];
  });
  if (s.auction) {
    s.discarded.push(...s.auction.cards);
    s.turn = (s.auction.seller + 1) % s.players.length;
  }
  s.auction = null;
  s.phase = 'roundEnd';
  s.log.push(`第 ${s.round} 季结束：${reason}。作品已按本季行情出售。`);
}
function advance(s: GameState, seller: number) {
  s.auction = null;
  const next = clockwise(
    (seller + 1) % s.players.length,
    s.players.length,
  ).find((i) => s.players[i].hand.length > 0);
  requireRule(next !== undefined, '无手牌时应先触发轮末结算');
  s.turn = next;
  s.phase = 'offer';
}
function finishAuction(s: GameState, winner: number, amount: number) {
  const a = s.auction!;
  s.players[winner].cash -= amount;
  if (winner === a.seller) s.bankFlow -= amount;
  else s.players[a.seller].cash += amount;
  s.players[winner].collection.push(...a.cards);
  s.transactions.push({
    round: s.round,
    seller: a.seller,
    buyer: winner,
    amount,
    cards: [...a.cards],
  });
  s.log.push(
    `${s.players[winner].name} 以 ${amount} 千元购得 ${ARTISTS[a.cards[0].artist].name} 的 ${a.cards.length} 幅作品${winner === a.seller ? '（支付给银行）' : `（支付给 ${s.players[a.seller].name}）`}。`,
  );
  advance(s, a.seller);
}
function afterCard(s: GameState): boolean {
  const a = s.auction!;
  if (s.counts[a.cards[0].artist] >= 5) {
    endRound(
      s,
      `${ARTISTS[a.cards[0].artist].name} 第五幅作品亮相，当前拍品不成交`,
    );
    return true;
  }
  if (s.players.every((p) => p.hand.length === 0)) {
    endRound(s, '所有玩家手牌耗尽，最后拍品不成交');
    return true;
  }
  return false;
}
function startAuction(s: GameState, type: AuctionType) {
  const a = s.auction!;
  a.type = type;
  if (type === 'double') {
    s.phase = 'pair';
    a.queue = clockwise(a.seller, s.players.length);
  } else if (type === 'fixed') {
    s.phase = 'price';
    a.queue = [a.seller];
  } else {
    s.phase = 'bid';
    a.queue = clockwise((a.seller + 1) % s.players.length, s.players.length);
  }
}
function takeCard(s: GameState, player: number, id: string): Card {
  const hand = s.players[player].hand,
    i = hand.findIndex((c) => c.id === id);
  requireRule(i >= 0, '这张画不在你的手牌中');
  return hand.splice(i, 1)[0];
}
export function actor(
  s: Pick<GameState, 'phase' | 'turn' | 'auction'>,
): number | null {
  if (s.phase === 'offer') return s.turn;
  if (s.phase === 'roundEnd' || s.phase === 'finished') return null;
  return s.auction?.queue[0] ?? null;
}
function amountValid(amount: number, cash: number) {
  requireRule(
    Number.isSafeInteger(amount) && amount >= 0 && amount <= cash,
    '金额必须为不超过现金的非负整数',
  );
}
export function applyAction(state: GameState, action: Action): GameState {
  requireRule(state.phase !== 'finished', '游戏已经结束');
  const s = structuredClone(state);
  if (action.type === 'next') {
    requireRule(s.phase === 'roundEnd', '尚未到轮末');
    if (s.round === 4 || s.players.every((p) => !p.hand.length)) {
      s.phase = 'finished';
      s.log.push('拍卖季落幕，公开各馆最终财富。');
    } else {
      s.round++;
      s.counts = [0, 0, 0, 0, 0];
      deal(s);
      s.phase = 'offer';
      s.turn = clockwise(s.turn, s.players.length).find(
        (i) => s.players[i].hand.length > 0,
      )!;
      s.log.push(
        `第 ${s.round} 季开幕。${s.round === 4 ? '本季不再补发手牌。' : '新作已加入各馆手牌。'}`,
      );
    }
  } else {
    requireRule(
      Number.isInteger(action.player) && action.player === actor(s),
      '还没有轮到你',
    );
    const p = s.players[action.player];
    if (action.type === 'offer') {
      requireRule(s.phase === 'offer', '当前不能出画');
      const c = takeCard(s, p.id, action.card);
      s.auction = {
        seller: p.id,
        cards: [c],
        type: c.type,
        high: 0,
        bidder: null,
        price: null,
        queue: [],
        bids: {},
      };
      s.counts[c.artist]++;
      s.log.push(
        `${p.name} 推出 ${ARTISTS[c.artist].name} 的作品 · ${TYPES[c.type].name}。`,
      );
      if (!afterCard(s)) startAuction(s, c.type);
    } else if (action.type === 'pair') {
      requireRule(s.phase === 'pair', '当前不是补画阶段');
      const a = s.auction!;
      if (action.card !== null) {
        const c = takeCard(s, p.id, action.card);
        requireRule(
          c.artist === a.cards[0].artist && c.type !== 'double',
          '必须搭配同艺术家的非双重拍卖作品',
        );
        a.cards.push(c);
        a.seller = p.id;
        s.counts[c.artist]++;
        s.log.push(`${p.name} 补入第二幅作品，接任拍卖师。`);
        if (!afterCard(s)) startAuction(s, c.type);
      } else {
        a.queue.shift();
        if (!a.queue.length) finishAuction(s, a.seller, 0);
      }
    } else if (action.type === 'price') {
      requireRule(s.phase === 'price', '当前不能定价');
      amountValid(action.amount, p.cash);
      const a = s.auction!;
      a.price = action.amount;
      a.queue = clockwise(
        (a.seller + 1) % s.players.length,
        s.players.length,
        s.players.length - 1,
      );
      s.phase = 'bid';
      s.log.push(`${p.name} 定价 ${action.amount} 千元。`);
    } else if (action.type === 'buy') {
      requireRule(
        s.phase === 'bid' && s.auction?.type === 'fixed',
        '当前不能按一口价购买',
      );
      const a = s.auction!;
      requireRule(typeof action.accept === 'boolean', '购买选择无效');
      if (action.accept) {
        amountValid(a.price!, p.cash);
        finishAuction(s, p.id, a.price!);
      } else {
        s.log.push(`${p.name} 放弃购买。`);
        a.queue.shift();
        if (!a.queue.length) finishAuction(s, a.seller, a.price!);
      }
    } else if (action.type === 'bid') {
      requireRule(
        s.phase === 'bid' && s.auction?.type !== 'fixed',
        '当前不能出价',
      );
      const a = s.auction!;
      if (a.type === 'sealed') {
        requireRule(action.amount !== null, '秘密竞价请填写金额，0 表示不出价');
        amountValid(action.amount, p.cash);
        a.bids[p.id] = action.amount;
        a.queue.shift();
        // Do not log bids until all players have locked them in.
        if (!a.queue.length) {
          const order = clockwise(a.seller, s.players.length),
            winner = order.reduce(
              (best, i) => (a.bids[i] > a.bids[best] ? i : best),
              a.seller,
            );
          s.log.push(
            `暗标揭晓：${order.map((i) => `${s.players[i].name} ${a.bids[i]}`).join(' / ')}。`,
          );
          finishAuction(s, winner, a.bids[winner]);
        }
      } else {
        requireRule(a.type === 'open' || a.type === 'once', '拍卖类型无效');
        if (action.amount !== null) {
          amountValid(action.amount, p.cash);
          requireRule(action.amount > a.high, '必须高于当前报价');
          a.high = action.amount;
          a.bidder = p.id;
          s.log.push(`${p.name} 出价 ${action.amount} 千元。`);
        } else
          s.log.push(
            `${p.name} ${a.type === 'open' ? '暂不加价' : '放弃出价'}。`,
          );
        if (a.type === 'open' && action.amount !== null)
          a.queue = clockwise(
            (p.id + 1) % s.players.length,
            s.players.length,
            s.players.length - 1,
          );
        else a.queue.shift();
        if (!a.queue.length) finishAuction(s, a.bidder ?? a.seller, a.high);
      }
    } else throw new Error('未知行动');
  }
  s.actions.push(action);
  return s;
}
export function observe(s: GameState, id: number): Observation {
  const { bids: _bids, ...auction } = s.auction ?? { bids: {} };
  return structuredClone({
    round: s.round,
    turn: s.turn,
    phase: s.phase,
    self: s.players[id],
    players: s.players.map((p) => ({
      id: p.id,
      handCount: p.hand.length,
      collection: p.collection,
    })),
    counts: s.counts,
    awards: s.history.map((r) => r.awards),
    publicLog: s.log,
    transactions: s.transactions,
    settledIncome: s.players.map((_, i) =>
      s.history.reduce((sum, r) => sum + r.income[i], 0),
    ),
    revealed: [
      ...s.discarded,
      ...s.players.flatMap((p) => p.collection),
      ...(s.auction?.cards ?? []),
    ],
    names: s.players.map((p) => p.name),
    auction: s.auction ? auction : null,
  }) as Observation;
}
export function assertState(s: GameState) {
  const all = [
    ...s.deck,
    ...s.discarded,
    ...s.players.flatMap((p) => [...p.hand, ...p.collection]),
    ...(s.auction?.cards ?? []),
  ];
  requireRule(
    all.length === 70 && new Set(all.map((c) => c.id)).size === 70,
    '卡牌不守恒',
  );
  requireRule(
    s.players.every((p) => Number.isSafeInteger(p.cash) && p.cash >= 0),
    '现金非法',
  );
  requireRule(
    s.players.reduce((sum, p) => sum + p.cash, 0) ===
      100 * s.players.length + s.bankFlow,
    '资金不守恒',
  );
  requireRule(
    s.counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 5),
    '市场计数非法',
  );
  if (!['roundEnd', 'finished'].includes(s.phase)) {
    const onTable = [
      ...s.players.flatMap((p) => p.collection),
      ...(s.auction?.cards ?? []),
    ];
    requireRule(
      s.counts.every(
        (n, a) => n === onTable.filter((c) => c.artist === a).length,
      ),
      '市场计数与作品不符',
    );
    requireRule(actor(s) !== null, '缺少行动玩家');
  }
}
