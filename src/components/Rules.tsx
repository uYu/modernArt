import { useState } from 'react';
import { ARTISTS, DEALS, TYPES } from '../game/data.ts';
import type { AuctionType } from '../game/types.ts';

const chapters = {
  overview: '如何开始',
  auctions: '五种拍卖',
  settlement: '季末算钱',
  reference: '操作与疑问',
};
type Chapter = keyof typeof chapters;
const auctions: {
  type: AuctionType;
  steps: string[];
  example: string;
  note: string;
}[] = [
  {
    type: 'open',
    steps: [
      '从卖家之后开始，按座次顺时针询问，每次报价必须高于当前最高价。卖家也能参与。',
      '有人加价后，其他人重新获得机会；整圈无人加价，最高报价者买下。',
    ],
    example: '你暂不加价，下一位加到 12。再次轮到你时，你仍可出 13 或更高。',
    note: '“暂不加价”不是永久退出。本网页版按顺序询问，不采用同时自由喊价。',
  },
  {
    type: 'once',
    steps: [
      '从卖家之后开始，每人依次选择报价或放弃，卖家最后行动。',
      '每人只有一次机会；报价必须超过当前最高价，最后由最高报价者买下。',
    ],
    example:
      '前面有人出 18，你可以出 19 或更高，也可以放弃。你出 20 后，即使别人出 21 超过你，你也不能再加。',
    note: '卖家同样只有一次机会，但能先看到其他人的报价。',
  },
  {
    type: 'sealed',
    steps: [
      '每人锁定一个不超过自己现金的整数报价，0 表示不报价。锁定后不能修改。',
      '全部锁定后一起揭晓，最高者按自己的报价付款。平价时卖家优先；卖家不在最高价中时，从卖家之后按顺时针顺序确定赢家。',
    ],
    example:
      '你与卖家都报 20，卖家获胜。若卖家只报 10，另外两人都报 20，则顺时针更靠近卖家的那位获胜。',
    note: '逐人操作不代表后报价者能看到前面的金额。所有人都报 0 时，卖家免费取得作品。',
  },
  {
    type: 'fixed',
    steps: [
      '卖家设定一个不超过自己现金的价格，可以是 0。',
      '从卖家之后开始，其他人按顺序决定买或不买。第一位接受的人立即买下。',
      '全部拒绝时，卖家必须按这个价格自购，钱付给银行。',
    ],
    example:
      '你有 100，定价 20。无人接受后，你的现金变为 80，作品成为你的藏品。',
    note: '定价不是保留价。不能因为没人买就收回手牌，也不能定出自己付不起的价格。',
  },
  {
    type: 'double',
    steps: [
      '先出双重牌。原卖家先决定是否补一张同艺术家的非双重牌；不补时，其他人依次获得补画机会。',
      '补画者成为这场拍卖的新卖家。两幅一起拍卖，采用第二张牌的拍卖方式，报价是两幅的总价。',
      '新卖家获得全部成交款，不与第一张牌的提供者分成。若新卖家自购，钱付给银行。之后从新卖家后面继续出画。',
      '所有人都不补画时，原卖家免费取得那张双重牌。',
    ],
    example:
      '你出林序双重牌，方圆馆补一张林序公开竞价牌。两幅合计成交 24，24 全部付给方圆馆；若方圆馆自己买，则付给银行。',
    note: '不能用另一张双重牌来搭配。如果第一幅就触发第五幅，直接结算；第二幅触发时，两幅都不成交。',
  },
];

export function Rules({ currentAuction }: { currentAuction?: AuctionType }) {
  const [chapter, setChapter] = useState<Chapter>('overview');
  const [auctionType, setAuctionType] = useState<AuctionType>(
    currentAuction ?? 'open',
  );
  const auction = auctions.find((a) => a.type === auctionType)!;
  return (
    <div className="rules rules-guide">
      <p className="guide-intro">
        通过卖画赚取现金、买画等待季末清算，经营你的美术馆。四季结束后，现金最多者获胜；最高现金相同则并列获胜。金额单位均为千元。
      </p>
      {currentAuction && (
        <button
          className="guide-current"
          onClick={() => {
            setAuctionType(currentAuction);
            setChapter('auctions');
          }}
        >
          查看本场「{TYPES[currentAuction].name}」规则 →
        </button>
      )}
      <nav className="guide-nav" aria-label="玩法指南章节">
        {Object.entries(chapters).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={chapter === key}
            onClick={() => setChapter(key as Chapter)}
          >
            {label}
          </button>
        ))}
      </nav>
      {chapter === 'overview' && (
        <section aria-label="如何开始">
          <h3>先分清两种画</h3>
          <div className="guide-columns">
            <div>
              <h4>手牌 · 等着卖</h4>
              <p>
                只有你能看见的待拍作品。你轮到出画时，从这里选择一幅。手牌在季末不换钱，会保留到下一季。
              </p>
            </div>
            <div>
              <h4>藏品 · 已经买下</h4>
              <p>
                通过拍卖获得，放在美术馆桌面上。它们在季末按最终行情统一卖给银行，然后离开游戏。
              </p>
            </div>
          </div>
          <h3>一场拍卖怎么进行</h3>
          <ol>
            <li>
              <strong>轮到你出画：</strong>
              选一张手牌并确认。卡上的符号决定拍卖方式，你成为卖家（拍卖师）。
            </li>
            <li>
              <strong>所有人参与拍卖：</strong>
              包括卖家。根据拍卖方式报价、锁定暗标或决定购买。
            </li>
            <li>
              <strong>买家付钱、拿画：</strong>
              作品加入买家的藏品。通常下一位出画者是卖家之后的人，与谁买下作品无关。双重拍卖有人接任时，从新卖家之后继续。
            </li>
            <li>
              <strong>留意季末：</strong>
              任一艺术家的第五幅亮相，立刻停止拍卖并结算；触发结算的拍品不成交。
            </li>
          </ol>
          <div className="guide-callout">
            <strong>钱付给谁？</strong>
            <p>
              买别人的画 → 付给卖家。卖家买自己的画 → 付给银行。季末清算 →
              银行付给藏品持有人。
            </p>
            <p>公开竞价或一次出价全部无人报价时，卖家免费获得作品。</p>
          </div>
          <h3>开局与补牌</h3>
          <p>
            3–5 人，每馆初始
            100，随机先手。每季保留旧手牌，再按下表发新牌；第四季不补牌。
          </p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>人数</th>
                <th>开局</th>
                <th>第二季</th>
                <th>第三季</th>
                <th>第四季</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(DEALS).map(([n, deals]) => (
                <tr key={n}>
                  <th>{n} 人</th>
                  {deals.map((cards, i) => (
                    <td key={i}>{cards} 张</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            没有手牌的人跳过出画，但仍能参与竞买。若所有人手牌耗尽，最后拍品不成交，结算后提前结束整局。
          </p>
          <button className="secondary" onClick={() => setChapter('auctions')}>
            继续看五种拍卖 →
          </button>
        </section>
      )}
      {chapter === 'auctions' && (
        <section aria-label="五种拍卖">
          <p>先看牌上的拍卖符号，再决定怎么参与。切换下方类型查看具体规则。</p>
          <nav className="guide-auctions" aria-label="拍卖方式">
            {auctions.map(({ type }) => (
              <button
                key={type}
                aria-pressed={auctionType === type}
                onClick={() => setAuctionType(type)}
              >
                {TYPES[type].icon} {TYPES[type].name}
              </button>
            ))}
          </nav>
          <h3>
            {TYPES[auction.type].icon} {TYPES[auction.type].name}
          </h3>
          <ol>
            {auction.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="guide-example">
            <strong>例如</strong>
            <p>{auction.example}</p>
          </div>
          <div className="guide-callout">
            <strong>容易弄错</strong>
            <p>{auction.note}</p>
          </div>
          <p className="muted">
            所有报价和定价都是整数，不能超过当前现金。双画金额按两幅合计。
          </p>
        </section>
      )}
      {chapter === 'settlement' && (
        <section aria-label="季末算钱">
          <h3>1. 第五幅亮相，立即结束本季</h3>
          <p>
            同一艺术家的第五幅一出现，当前拍品不再拍卖，也没有买家付款，但它仍计入本季数量排名。双重拍卖的第二幅触发时，两幅都不成交；第一幅就触发时，不再补第二幅。
          </p>
          <h3>2. 按数量选出前三名</h3>
          <p>
            统计本季亮相作品，包括触发结算的未成交牌。数量最多的三位艺术家分别新增
            30、20、10 的奖励；没有作品亮相的艺术家不入榜。
          </p>
          <p>
            数量相同，按固定顺序优先：
            <strong>{ARTISTS.map((a) => a.name).join(' → ')}</strong>
            。这与界面采用横排或竖排无关。
          </p>
          <h3>3. 算出每幅藏品的清算价</h3>
          <div className="guide-callout">
            <strong>
              本季进前三：历季奖励之和，包含本季新增奖励。
              <br />
              本季没进前三：每幅值 0，即使以前很值钱。
            </strong>
          </div>
          <div className="guide-example">
            <strong>第二季的结算例子</strong>
            <p>
              假设第一季奖励为林序 30、蓝汐 20、莫野 10。本季数量为林序 2、蓝汐
              5、莫野 1、叶织 3、纪空 0。
            </p>
            <table className="guide-table">
              <thead>
                <tr>
                  <th>艺术家</th>
                  <th>本季数量</th>
                  <th>新增奖励</th>
                  <th>每幅清算</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>蓝汐</th>
                  <td>5</td>
                  <td>30</td>
                  <td>20 + 30 = 50</td>
                </tr>
                <tr>
                  <th>叶织</th>
                  <td>3</td>
                  <td>20</td>
                  <td>0 + 20 = 20</td>
                </tr>
                <tr>
                  <th>林序</th>
                  <td>2</td>
                  <td>10</td>
                  <td>30 + 10 = 40</td>
                </tr>
                <tr>
                  <th>莫野</th>
                  <td>1</td>
                  <td>0</td>
                  <td>0</td>
                </tr>
                <tr>
                  <th>纪空</th>
                  <td>0</td>
                  <td>0</td>
                  <td>0</td>
                </tr>
              </tbody>
            </table>
            <p>
              若你持有蓝汐 2 幅、莫野 1 幅，本季清算收入为 2 × 50 + 1 × 0 ={' '}
              <strong>100</strong>。莫野过去的 10
              没有被删除；未来重新进入前三时，仍可累加。
            </p>
          </div>
          <h3>4. 清空藏品，保留手牌</h3>
          <p>
            银行付清收入后，本季藏品全部弃置。手牌保留，下一季各艺术家出画数量从
            0 重新计算，历史奖励保留。第四季结算后公开所有人的最终财富。
          </p>
          <h3>清算收入不等于净利润</h3>
          <p>
            <strong>本季现金净增 = 卖画收入 − 买画支出 + 藏品清算收入。</strong>
            例如卖画收到 24、买画花 20、清算得到 30，本季净增是 34，不是
            30。自购只记支出，不记卖画收入。
          </p>
        </section>
      )}
      {chapter === 'reference' && (
        <section aria-label="操作与疑问">
          <h3>操作速查</h3>
          <ul>
            <li>
              <strong>出画：</strong>
              点击手牌，再点“确认出画”。艺术家色点可以筛选手牌。
            </li>
            <li>
              <strong>报价：</strong>
              输入金额，或使用最低加价、+5、+10；确认前可以修改。提交后不能撤回。
            </li>
            <li>
              <strong>暗标：</strong>输入 0
              表示不报价，再点“锁定暗标”。对手的未揭晓报价保持隐藏。
            </li>
            <li>
              <strong>成交：</strong>
              提醒里显示买家、卖家、作品和总价；侧栏“最近成交”可回看。一口价成交需手动确认。
            </li>
            <li>
              <strong>暂停与查看：</strong>打开玩法指南、存档或记牌面板时，AI
              暂停推进。关闭后继续；也可在对局底部手动暂停。
            </li>
            <li>
              <strong>保存：</strong>
              每步自动保存在此浏览器。存档管理有三个槽位，也能导入导出。换浏览器、域名或端口前，先导出进度。
            </li>
            <li>
              <strong>赛后：</strong>
              复盘可逐步重放、查看财富和交易盈亏；同一发牌再挑战会保留先手与 AI
              配置。
            </li>
          </ul>
          <h3>常见疑问</h3>
          <details>
            <summary>历季定价表为什么不是现在能卖多少钱？</summary>
            <p>
              表格记录每季新增的 30 / 20 / 10
              奖励，不是当前保证价格。最终必须看本季是否进入前三，再累计历史奖励；本季跌出前三就是
              0。
            </p>
          </details>
          <details>
            <summary>为什么对手现金和当前排名没有直接显示？</summary>
            <p>
              普通模式保留记忆公开交易和观察桌面的乐趣。记牌辅助可汇总公开账目、历季交易和剩余牌，不展示对手手牌、牌堆构成或未揭晓暗标。
            </p>
          </details>
          <details>
            <summary>四种难度怎么选？</summary>
            <p>
              入门也会正常估价和争抢有价值的画，但估值有适度偏差，选画主要看自己的眼前收益。中等判断更稳定，会考虑现有藏品和卖画收入；困难会在季末临近或第四季推演出牌；专家每次选画与补画都会推演不同场景。所有难度只使用自己的手牌和公开信息，没有额外资金或偷看手牌的优势。难度更高不代表每次报价更高，也不保证每局获胜。
            </p>
          </details>
          <details>
            <summary>买得便宜就一定赚钱吗？</summary>
            <p>
              不一定。买入价由本场竞价决定，清算价由季末排名决定。一幅 5
              千元买来的画，若画家最终未进前三，仍会亏掉这 5 千元。
            </p>
          </details>
          <details>
            <summary>双重拍卖后，下一次该谁出画？</summary>
            <p>
              从最终卖家之后继续，跳过没有手牌的人。别人补画接任卖家时，原卖家与接任者之间的人不会补回出画机会。
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
