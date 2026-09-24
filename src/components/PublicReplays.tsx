import { useEffect, useState } from 'react';
import { deserialize } from '../game/storage.ts';
import type { GameState } from '../game/types.ts';
import { Replay } from './Replay.tsx';

interface ReplayItem {
  id: string;
  createdAt: string;
  playerCount: number;
  actionCount: number;
  humanCash: number;
  winningCash: number;
}

export function PublicReplays() {
  const [items, setItems] = useState<ReplayItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{
    id: string;
    game: GameState;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    fetch(`/api/replays?offset=${offset}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取公开对局');
        return response.json();
      })
      .then((data: { items: ReplayItem[]; total: number }) => {
        setItems(data.items);
        setTotal(data.total);
        setError('');
      })
      .catch((reason) => {
        if (reason.name !== 'AbortError')
          setError('公开对局暂时无法读取，请稍后重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [offset]);

  async function open(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/replays/${id}`);
      if (!response.ok) throw new Error('无法读取这场对局');
      const data = await response.json();
      const game = deserialize(JSON.stringify(data.replay));
      if (game.phase !== 'finished') throw new Error('对局尚未结束');
      setSelected({ id, game });
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取这场对局');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-replays">
      {selected ? (
        <>
          <button className="text-button" onClick={() => setSelected(null)}>
            ← 返回对局列表
          </button>
          <Replay key={selected.id} game={selected.game} publicView />
        </>
      ) : (
        <>
          <p>已完成的对局会自动公开保存，任何人都可以浏览赛况与逐步回放。</p>
          {error && <p role="alert">{error}</p>}
          {busy && <p>读取中…</p>}
          {!busy && !error && items.length === 0 && <p>还没有公开对局。</p>}
          <div className="public-replay-list">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => open(item.id)}
                disabled={busy}
              >
                <strong>
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </strong>
                <span>
                  {item.playerCount} 人局 · {item.actionCount} 步 · 白昼美术馆{' '}
                  {item.humanCash} 千元 · 最高 {item.winningCash} 千元
                </span>
                <small>查看回放 →</small>
              </button>
            ))}
          </div>
          {total > 20 && (
            <div className="review-controls">
              <button
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                上一页
              </button>
              <span>
                {Math.floor(offset / 20) + 1} / {Math.ceil(total / 20)}
              </span>
              <button
                disabled={offset + 20 >= total || busy}
                onClick={() => setOffset(offset + 20)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
