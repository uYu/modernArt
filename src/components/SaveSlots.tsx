import { useState } from 'react';
import { deserialize, serialize } from '../game/storage.ts';
import type { GameState } from '../game/types.ts';
const KEY = 'modern-art.slot.';
export function SaveSlots({
  game,
  load,
}: {
  game: GameState | null;
  load: (game: GameState) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const slots = [0, 1, 2].map((id) => {
    try {
      const raw = localStorage.getItem(KEY + id);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const state = deserialize(data.save);
      return { ...data, state };
    } catch {
      return { broken: true };
    }
  });
  function save(id: number) {
    if (!game) return;
    if (slots[id] && confirm !== id) {
      setConfirm(id);
      return;
    }
    try {
      localStorage.setItem(
        KEY + id,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          save: serialize(game),
        }),
      );
      setConfirm(null);
      setRevision(revision + 1);
      setMessage('已保存。');
    } catch {
      setMessage('保存失败，浏览器存储空间可能不足，请导出存档。');
    }
  }
  return (
    <div className="save-slots">
      <p>三个独立存档槽。载入前会备份当前对局；损坏槽位不会自动删除。</p>
      {slots.map((slot, i) => (
        <div className="save-slot" key={i}>
          <div>
            <strong>存档 {i + 1}</strong>
            <p>
              {!slot
                ? '空槽'
                : slot.broken
                  ? '存档损坏'
                  : `${slot.state.players.length} 人 · 第 ${slot.state.round} 季 · ${slot.state.actions.length} 步`}
            </p>
            {slot && !slot.broken && (
              <small>{new Date(slot.savedAt).toLocaleString()}</small>
            )}
          </div>
          <div>
            <button
              className="secondary"
              disabled={!game}
              onClick={() => save(i)}
            >
              {confirm === i ? '确认覆盖此槽' : '保存到此槽'}
            </button>
            <button
              className="secondary"
              disabled={!slot || slot.broken}
              onClick={() => {
                try {
                  if (game)
                    localStorage.setItem(KEY + 'backup', serialize(game));
                  load(deserialize(slot.save));
                } catch {
                  setMessage('载入或备份失败，当前对局未被替换。');
                }
              }}
            >
              载入并替换
            </button>
          </div>
        </div>
      ))}
      <button
        className="text-button"
        onClick={() => {
          try {
            const raw = localStorage.getItem(KEY + 'backup');
            if (!raw) {
              setMessage('还没有载入前备份。');
              return;
            }
            const restored = deserialize(raw);
            if (game) localStorage.setItem(KEY + 'backup', serialize(game));
            load(restored);
          } catch {
            setMessage('无法恢复备份，当前对局未被替换。');
          }
        }}
      >
        恢复上次载入前的对局
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
