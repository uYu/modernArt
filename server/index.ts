import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize, serialize } from '../src/game/storage.ts';

const databasePath = process.env.REPLAY_DB_PATH ?? './data/replays.sqlite';
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    action_count INTEGER NOT NULL,
    human_cash INTEGER NOT NULL,
    winning_cash INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS replays_created_at ON replays(created_at DESC, id DESC);
`);

const insert = db.prepare(`INSERT OR IGNORE INTO replays
  (id, created_at, player_count, action_count, human_cash, winning_cash, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const list =
  db.prepare(`SELECT id, created_at AS createdAt, player_count AS playerCount,
  action_count AS actionCount, human_cash AS humanCash, winning_cash AS winningCash
  FROM replays ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`);
const count = db.prepare('SELECT COUNT(*) AS total FROM replays');
const get = db.prepare('SELECT payload FROM replays WHERE id = ?');

function json(
  res: import('node:http').ServerResponse,
  status: number,
  data: unknown,
) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error('对局记录过大');
  }
  return body;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { ok: true });
    } else if (req.method === 'GET' && url.pathname === '/api/replays') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
        json(res, 400, { error: '分页参数无效' });
        return;
      }
      json(res, 200, {
        items: list.all(20, offset),
        total: count.get()?.total,
      });
    } else if (
      req.method === 'GET' &&
      /^\/api\/replays\/[a-f0-9]{64}$/.test(url.pathname)
    ) {
      const row = get.get(url.pathname.split('/')[3]) as
        { payload: string } | undefined;
      if (!row) json(res, 404, { error: '未找到这场对局' });
      else json(res, 200, { replay: JSON.parse(row.payload) });
    } else if (req.method === 'POST' && url.pathname === '/api/replays') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
        json(res, 415, { error: '请提交 JSON 对局记录' });
        return;
      }
      const raw = await readBody(req);
      const game = deserialize(raw);
      if (game.phase !== 'finished' || game.actions.length > 3000)
        throw new Error('仅接受已结束的完整对局');
      const payload = serialize(game);
      const id = createHash('sha256').update(payload).digest('hex');
      insert.run(
        id,
        new Date().toISOString(),
        game.players.length,
        game.actions.length,
        game.players[0].cash,
        Math.max(...game.players.map((player) => player.cash)),
        payload,
      );
      json(res, 201, { id });
    } else {
      json(res, 404, { error: '未找到接口' });
    }
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : '对局记录无效',
    });
  }
});

const port = Number(process.env.API_PORT ?? 3000);
server.listen(port, '0.0.0.0', () =>
  console.log(`Replay API listening on ${port}`),
);
