import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import dayjs from "dayjs";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: "*" }));

// --- 初始化 SQLite ---
const db = new Database("tracker.db");

// 建表（若尚未存在）
db.prepare(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    type TEXT,
    userId TEXT,
    session_id TEXT,
    page TEXT,
    properties TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    result_name TEXT,
    scores TEXT
  )
`).run();

// --- 事件紀錄 ---
app.post("/api/events", (req, res) => {
  try {
    const { batch } = req.body;
    if (Array.isArray(batch)) {
      const stmt = db.prepare(
        "INSERT INTO events (ts, type, userId, session_id, page, properties) VALUES (@ts, @type, @userId, @sessionId, @page, @properties)"
      );
      const insert = db.transaction((rows) => {
        for (const r of rows) stmt.run({
          ts: r.ts || new Date().toISOString(),
          type: r.event,
          userId: r.userId,
          sessionId: r.sessionId,
          page: r.page,
          properties: JSON.stringify(r.properties || {})
        });
      });
      insert(batch);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ /api/events error:", err);
    res.status(500).json({ error: "Failed to insert event" });
  }
});

// --- 測驗結果 ---
app.post("/api/results", (req, res) => {
  try {
    const { result_name, scores } = req.body;
    db.prepare(
      "INSERT INTO results (ts, result_name, scores) VALUES (?, ?, ?)"
    ).run(new Date().toISOString(), result_name, JSON.stringify(scores));
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ /api/results error:", err);
    res.status(500).json({ error: "Failed to insert result" });
  }
});

// === 📊 Dashboard 資料統計 ===
app.get("/api/dashboard", (req, res) => {
  try {
    const today = dayjs().format("YYYY-MM-DD");

    const totalEvents = db.prepare("SELECT COUNT(*) AS count FROM events").get().count || 0;
    const totalSessions = db.prepare("SELECT COUNT(DISTINCT session_id) AS count FROM events").get().count || 0;
    const todayEvents = db.prepare("SELECT COUNT(*) AS count FROM events WHERE ts >= ?").get(`${today}T00:00:00Z`).count || 0;
    const todayUsers = db.prepare("SELECT COUNT(DISTINCT session_id) AS count FROM events WHERE ts >= ?").get(`${today}T00:00:00Z`).count || 0;

    const topEvents = db.prepare("SELECT type AS event_name, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC LIMIT 6").all();
    const pageViews = db.prepare("SELECT page, COUNT(*) AS count FROM events GROUP BY page ORDER BY count DESC LIMIT 6").all();
    const quizResults = db.prepare("SELECT result_name, COUNT(*) AS count FROM results GROUP BY result_name ORDER BY count DESC LIMIT 6").all();
    const hourlyEvents = db.prepare("SELECT strftime('%H', ts) AS hour, COUNT(*) AS count FROM events WHERE ts >= ? GROUP BY hour ORDER BY hour ASC").all(`${today}T00:00:00Z`);

    res.json({
      totalEvents,
      totalUsers: totalSessions,
      totalSessions,
      todayEvents,
      todayUsers,
      topEvents,
      pageViews,
      quizResults,
      hourlyEvents
    });
  } catch (err) {
    console.error("❌ /api/dashboard error:", err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// === 🟢 Realtime 即時資料 ===
app.get("/api/realtime", (req, res) => {
  try {
    const since = dayjs().subtract(5, "minute").toISOString();
    const recentEvents = db.prepare("SELECT COUNT(*) AS count FROM events WHERE ts >= ?").get(since).count || 0;
    const onlineUsers = db.prepare("SELECT COUNT(DISTINCT session_id) AS count FROM events WHERE ts >= ?").get(since).count || 0;
    const recentEventList = db.prepare("SELECT ts AS timestamp, type AS event_name, session_id, page FROM events ORDER BY ts DESC LIMIT 10").all();

    res.json({ recentEvents, onlineUsers, recentEventList });
  } catch (err) {
    console.error("❌ /api/realtime error:", err);
    res.status(500).json({ error: "Failed to load realtime data" });
  }
});

// --- 靜態檔案 ---
app.use(express.static("./"));

// --- 啟動伺服器 ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
