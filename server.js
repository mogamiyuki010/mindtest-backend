// === server.js ===
// 完整支援 Render / 本地 / GitHub Pages 的版本

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import Database from "better-sqlite3";

const app = express();

// 🧩 使用 process.cwd() 確保 Render 可寫入
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

// 確保資料夾存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 初始化 DB
const db = new Database(DB_PATH);

// === 建立資料表 ===
db.prepare(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT,
  session_id TEXT,
  ip TEXT,
  page TEXT,
  type TEXT,
  payload TEXT
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  ts TEXT,
  session_id TEXT,
  result_name TEXT,
  scores TEXT
);
`).run();

// === Middleware ===
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: ["https://mogamiyuki010.github.io", "http://localhost:5500"],
    credentials: true,
  })
);

// === Session Cookie ===
app.use((req, res, next) => {
  if (!req.cookies.session_id) {
    res.cookie("session_id", `sess_${Date.now()}_${nanoid(6)}`, {
      httpOnly: false,
      sameSite: "lax",
      secure: false,
    });
  }
  next();
});

// === INSERT statements ===
const stInsertEvent = db.prepare(`
INSERT INTO events (id, ts, session_id, ip, page, type, payload)
VALUES (@id, @ts, @session_id, @ip, @page, @type, @payload);
`);

const stInsertResult = db.prepare(`
INSERT INTO results (id, ts, session_id, result_name, scores)
VALUES (@id, @ts, @session_id, @result_name, @scores);
`);

// === API: 健康檢查 ===
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// === API: 接收事件批次 ===
app.post("/api/events", (req, res) => {
  try {
    const { batch = [] } = req.body || {};
    const now = new Date().toISOString();
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const session_id = req.cookies.session_id || "";

    const insert = db.transaction((events) => {
      for (const e of events) {
        stInsertEvent.run({
          id: nanoid(),
          ts: e.ts || now,
          session_id: e.sessionId || session_id,
          ip: String(ip),
          page: String(e.page || ""),
          type: String(e.event || "custom"),
          payload: JSON.stringify(e.properties || {}),
        });
      }
    });
    insert(batch);

    res.json({ ok: true, count: batch.length });
  } catch (err) {
    console.error("POST /api/events Error:", err);
    res.status(500).json({ error: "Failed to insert events." });
  }
});

// === API: 儲存測驗結果 ===
app.post("/api/results", (req, res) => {
  try {
    const { result_name, scores } = req.body;
    const now = new Date().toISOString();
    const session_id = req.cookies.session_id || "";
    stInsertResult.run({
      id: nanoid(),
      ts: now,
      session_id,
      result_name: result_name || "unknown",
      scores: JSON.stringify(scores || {}),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/results Error:", err);
    res.status(500).json({ error: "Failed to save result." });
  }
});

// === API: fallback /api/track ===
app.post("/api/track", (req, res) => {
  try {
    const now = new Date().toISOString();
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const session_id = req.cookies.session_id;
    const body = req.body || {};

    stInsertEvent.run({
      id: nanoid(),
      ts: now,
      session_id,
      ip: String(ip),
      page: String(body.page || ""),
      type: String(body.event || "custom"),
      payload: JSON.stringify(body.properties || {}),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/track Error:", err);
    res.status(500).json({ error: "Failed to insert track." });
  }
});

// === API: Dashboard 總覽 ===
app.get("/api/dashboard", (req, res) => {
  try {
    const today = dayjs().startOf("day").toISOString();
    const totalEvents = db.prepare(`SELECT COUNT(*) AS count FROM events`).all();
    const totalUsers = db.prepare(`SELECT COUNT(DISTINCT session_id) AS count FROM events`).all();
    const totalSessions = db.prepare(`SELECT COUNT(DISTINCT session_id) AS count FROM events`).all();
    const todayEvents = db.prepare(`SELECT COUNT(*) AS count FROM events WHERE ts >= ?`).all(today);
    const todayUsers = db.prepare(`SELECT COUNT(DISTINCT session_id) AS count FROM events WHERE ts >= ?`).all(today);

    const topEvents = db
      .prepare(`SELECT type AS event_name, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC LIMIT 5`)
      .all();

    const pageViews = db
      .prepare(`SELECT page, COUNT(*) AS count FROM events WHERE page != '' GROUP BY page ORDER BY count DESC LIMIT 5`)
      .all();

    const quizResults = db
      .prepare(`SELECT result_name AS result, COUNT(*) AS count FROM results GROUP BY result_name`)
      .all();

    const hourlyEvents = db
      .prepare(`SELECT substr(ts, 12, 2) AS hour, COUNT(*) AS count FROM events GROUP BY hour ORDER BY hour ASC`)
      .all();

    res.json({
      totalEvents,
      totalUsers,
      totalSessions,
      todayEvents,
      todayUsers,
      topEvents,
      pageViews,
      quizResults,
      hourlyEvents,
    });
  } catch (err) {
    console.error("GET /api/dashboard Error:", err);
    res.status(500).json({ error: "Failed to load dashboard data." });
  }
});

// === API: Realtime ===
app.get("/api/realtime", (req, res) => {
  try {
    const fiveMinAgo = dayjs().subtract(5, "minute").toISOString();
    const recentEvents = db.prepare(`SELECT COUNT(*) AS count FROM events WHERE ts >= ?`).all(fiveMinAgo);
    const onlineUsers = db
      .prepare(`SELECT COUNT(DISTINCT session_id) AS count FROM events WHERE ts >= ?`)
      .all(fiveMinAgo);
    const recentEventList = db
      .prepare(
        `SELECT ts AS timestamp, type AS event_name, session_id AS user_id, page 
         FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT 10`
      )
      .all(fiveMinAgo);
    res.json({ recentEvents, onlineUsers, recentEventList });
  } catch (err) {
    console.error("GET /api/realtime Error:", err);
    res.status(500).json({ error: "Failed to load realtime data." });
  }
});

// === 啟動伺服器 ===
const PORT = process.env.PORT || 3000;
app.listen(PORT,"0.0.0.0" () => {
  console.log(`✅ Server running on port ${PORT}`);
});
