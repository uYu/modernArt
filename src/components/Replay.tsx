import { useMemo, useState } from 'react';
import type { GameState } from '../game/types.ts';
import {
  replayAt,
  replayMilestones,
  seasonFinance,
  settlementMoments,
} from '../game/experience.ts';
import { ARTISTS, title } from '../game/data.ts';

export function Replay({ game, publicView = false }: { game: GameState; publicView?: boolean }) {
  const subject = publicView ? game.players[0].name : '你';
  const [step, setStep] = useState(game.actions.length);
  const state = useMemo(() => replayAt(game, step), [game, step]);
  const milestones = useMemo(() => replayMilestones(game), [game]);
  const moments = useMemo(() => settlementMoments(game), [game]);
  const wealth = game.players.map((p) => [
    100,
    ...game.history.map(
      (_, index) =>
        100 +
        game.history
          .slice(0, index + 1)
          .reduce((sum, r) => sum + seasonFinance(game, r.round, p.id).net, 0),
    ),
  ]);
  const ceiling = Math.max(100, ...wealth.flat());
  return (
    <div className="replay-panel">
      <p>赛后回放 · 只读查看公开场面，不改变原局。双画以整笔交易计算盈亏。</p>
      <svg
        className="wealth-chart"
        viewBox="0 0 500 180"
        role="img"
        aria-label="各馆每季结束财富曲线，详细数值见下表"
      >
        {[0, 1, 2, 3, 4].map((r) => (
          <text key={r} x={25 + r * 110} y={176} fontSize="11">
            {r === 0 ? '开局' : `第${r}季`}
          </text>
        ))}
        {wealth.map((points, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={ARTISTS[i].color}
            strokeWidth="3"
            points={points
              .map((v, r) => `${30 + r * 110},${150 - (v / ceiling) * 135}`)
              .join(' ')}
          />
        ))}
      </svg>
      <div className="table-scroll">
        <table className="review-table">
          <thead>
            <tr>
              <th>美术馆</th>
              <th>开局</th>
              {game.history.map((r) => (
                <th key={r.round}>第 {r.round} 季</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.players.map((p) => (
              <tr key={p.id}>
                <th style={{ color: ARTISTS[p.id].color }}>{p.name}</th>
                {wealth[p.id].map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>逐步回放</h3>
      <label>
        行动 {step} / {game.actions.length}
        <input
          aria-label="回放进度"
          type="range"
          min="0"
          max={game.actions.length}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </label>
      <div className="review-controls">
        <button
          disabled={step === 0}
          onClick={() => setStep(Math.max(0, step - 1))}
        >
          上一步
        </button>
        <button
          onClick={() =>
            setStep([...milestones].reverse().find((n) => n < step) ?? 0)
          }
        >
          上一场
        </button>
        <button
          onClick={() =>
            setStep(milestones.find((n) => n > step) ?? game.actions.length)
          }
        >
          下一场
        </button>
        <button
          disabled={step === game.actions.length}
          onClick={() => setStep(step + 1)}
        >
          下一步
        </button>
      </div>
      <div className="replay-state" aria-live="polite">
        <strong>
          第 {state.round} 季 ·{' '}
          {state.phase === 'finished'
            ? '终局'
            : state.phase === 'roundEnd'
              ? '结算'
              : state.auction
                ? '拍卖中'
                : '准备出画'}
        </strong>
        <p>{state.log.at(-1)}</p>
        {state.auction && (
          <p>
            拍品：{state.auction.cards.map(title).join('、')} ·{' '}
            {state.auction.type === 'sealed'
              ? '暗标未揭晓'
              : `当前价 ${state.auction.price ?? state.auction.high}`}
          </p>
        )}
        {state.players.map((p) => (
          <p key={p.id}>
            {p.name}：{p.cash} 千元 · 藏品{' '}
            {p.collection.map((c) => ARTISTS[c.artist].name).join('、') || '无'}
          </p>
        ))}
      </div>
      <h3>终季出牌</h3>
      <p className="muted">
        名次变化比较结算前后现金，不代表其他出牌一定会改变胜负。
      </p>
      {game.history.map((r) => {
        const moment = moments.find((m) => m.round === r.round);
        return (
          <div className="key-turn" key={r.round}>
            <p>
              第 {r.round} 季：
              {moment?.player != null ? game.players[moment.player].name : ''}
              触发结算。{r.reason}；未成交{' '}
              {r.unsold.map(title).join('、') || '无'}。{subject}的藏品清算{' '}
              {r.income[0]} 千元。
            </p>
            {moment && (
              <>
                <p>
                  现金名次：第 {moment.before} → 第 {moment.after}
                  （并列按相同名次）
                </p>
                <button
                  className="text-button"
                  onClick={() => setStep(moment.step)}
                >
                  回到此步
                </button>
              </>
            )}
          </div>
        );
      })}
      <h3>{subject}的逐笔买画盈亏</h3>
      <div className="table-scroll">
        <table className="review-table">
          <thead>
            <tr>
              <th>季</th>
              <th>作品</th>
              <th>买入</th>
              <th>清算</th>
              <th>盈亏</th>
            </tr>
          </thead>
          <tbody>
            {game.transactions
              .filter((t) => t.buyer === 0)
              .map((t, i) => {
                const r = game.history.find((r) => r.round === t.round)!;
                const sale = t.cards.reduce(
                  (v, c) => v + r.values[c.artist],
                  0,
                );
                return (
                  <tr key={i}>
                    <td>{t.round}</td>
                    <td>{t.cards.map(title).join('、')}</td>
                    <td>{t.amount}</td>
                    <td>{sale}</td>
                    <td>{sale - t.amount}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
