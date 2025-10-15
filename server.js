import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { nanoid } from 'nanoid';
import dayjs from 'dayjs';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// ---------- 基本設定 ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- DB 初始化 ----------
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    session_id TEXT,
    ip TEXT,
    page TEXT,
    type TEXT,
    payload TEXT
  );
  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    session_id TEXT,
    result_name TEXT,
    score_json TEXT
  );
`);

// ---------- 中介層 ----------
app.use(cors({
  origin: [
    "https://mogamiyuki010.github.io",
    "https://mogamiyuki010.github.io/mindtest",
    "http://localhost:3000",
    "https://localhost:3000"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// 自動生成 session_id
app.use((req, res, next) => {
  if (!req.cookies.session_id) {
    res.cookie('session_id', nanoid(), { maxAge: 10 * 24 * 3600 * 1000, httpOnly: true });
  }
  next();
});

// ---------- 預備語句 ----------
const stInsertEvent = db.prepare(`
  INSERT INTO events (id, ts, session_id, ip, page, type, payload)
  VALUES (@id, @ts, @session_id, @ip, @page, @type, @payload)
`);
const stInsertResult = db.prepare(`
  INSERT INTO results (id, ts, session_id, result_name, score_json)
  VALUES (@id, @ts, @session_id, @result_name, @score_json)
`);
const stQueryEvents = db.prepare(`
  SELECT * FROM events
  WHERE (@start IS NULL OR ts >= @start)
    AND (@end IS NULL OR ts <= @end)
  ORDER BY ts DESC
  LIMIT @limit OFFSET @offset
`);
const stQueryResults = db.prepare(`
  SELECT * FROM results
  WHERE (@start IS NULL OR ts >= @start)
    AND (@end IS NULL OR ts <= @end)
  ORDER BY ts DESC
  LIMIT @limit OFFSET @offset
`);

// ---------- API ----------

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 查詢事件
app.get('/api/events', (req, res) => {
  try {
    const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
    const limit = Math.min(Number(pageSize) || 100, 500);
    const offset = (Number(page) - 1) * limit;
    const params = {
      start: start ? dayjs(start).startOf('day').toISOString() : null,
      end: end ? dayjs(end).endOf('day').toISOString() : null,
      limit,
      offset
    };
    const items = stQueryEvents.all(params).map(r => ({
      id: r.id,
      timestamp: r.ts,
      event_name: r.type,
      session_id: r.session_id,
      page: r.page,
      properties: r.payload ? JSON.parse(r.payload) : {}
    }));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events.' });
  }
});

// 查詢結果
app.get('/api/results', (req, res) => {
  try {
    const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
    const limit = Math.min(Number(pageSize) || 100, 500);
    const offset = (Number(page) - 1) * limit;
    const params = {
      start: start ? dayjs(start).startOf('day').toISOString() : null,
      end: end ? dayjs(end).endOf('day').toISOString() : null,
      limit,
      offset
    };
    const items = stQueryResults.all(params).map(r => ({
      id: r.id,
      timestamp: r.ts,
      session_id: r.session_id,
      result: r.result_name,
      scores: r.score_json ? JSON.parse(r.score_json) : {}
    }));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch results.' });
  }
});

// 接收事件
app.post('/api/events', (req, res) => {
  try {
    const now = new Date().toISOString();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const session_id = req.cookies.session_id;
    const body = req.body || {};
    const items = Array.isArray(body.batch) ? body.batch : [body];
    const insertMany = db.transaction((arr) => {
      for (const it of arr) {
        stInsertEvent.run({
          id: nanoid(),
          ts: now,
          session_id,
          ip: String(ip),
          page: String(it.page || ''),
          type: String(it.type || 'custom'),
          payload: JSON.stringify(it.payload || {})
        });
      }
    });
    insertMany(items);
    res.json({ ok: true, inserted: items.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to insert events.' });
  }
});

// 儲存測驗結果
app.post('/api/results', (req, res) => {
  try {
    const now = new Date().toISOString();
    const session_id = req.cookies.session_id;
    const { result_name = '', scores = {} } = req.body || {};
    stInsertResult.run({
      id: nanoid(),
      ts: now,
      session_id,
      result_name: String(result_name),
      score_json: JSON.stringify(scores)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to insert result.' });
  }
});

// ---------- 根路由 ----------
app.get('/', (req, res) => {
  res.send('Backend is running ✅');
});

// ---------- 啟動 ----------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
