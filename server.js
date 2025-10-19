import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { nanoid } from 'nanoid';
import dayjs from 'dayjs';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 導入 dayjs 的擴充功能，用於處理日期範圍查詢
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// ---------- 基本設定與環境變數 ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

// 確保數據庫資料夾存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- DB 初始化與 Schema 建立 ----------
// 設置數據庫連線為只讀/寫，並啟用寫入同步
const db = new Database(DB_FILE, { verbose: (message) => { /* console.log(message) */ } });
db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL');

// 創建表格
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

// ---------- 中介層與 Session ID 處理 ----------
// ✅ 修正 CORS 配置 - 支援 GitHub Pages 和 RENDER 部署
app.use(cors({
    origin: [
        "https://mogamiyuki010.github.io",
        "https://mogamiyuki010.github.io/mindtest",
        "https://mindtest-backend.onrender.com",  // RENDER 部署域名
        "http://localhost:3000",  // 本地開發
        "https://localhost:3000"   // 本地 HTTPS
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// 自定義中介層：檢查並設定 Session ID (10天有效期)
app.use((req, res, next) => {
    if (!req.cookies.session_id) {
        // 設定 httpOnly: true 增加安全性
        res.cookie('session_id', nanoid(), { maxAge: 10 * 24 * 3600 * 1000, httpOnly: true }); 
    }
    next();
});

// ---------- SQL 預備語句 (優化後的查詢) ----------
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

// ---------- API 路由定義 ----------

// 健康檢查端點
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// ✅ 1. 查詢所有事件 (GET /api/events) - 供 admin.html 讀取
app.get('/api/events', (req, res) => {
    try {
        const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
        const limit = Math.min(Number(pageSize) || 100, 500);
        const offset = (Number(page) - 1) * limit;

        const params = {
            // 使用 dayjs 確保日期範圍包含整天 (startOf/endOf day)
            start: start ? dayjs(start).startOf('day').toISOString() : null,
            end: end ? dayjs(end).endOf('day').toISOString() : null,
            limit,
            offset
        };

        const items = stQueryEvents.all(params).map(r => ({
            id: r.id,
            timestamp: r.ts,
            event_name: r.type,
            user_id: r.session_id, 
            session_id: r.session_id,
            page: r.page,
            // 關鍵修正：將 payload 字符串解析為 JS Object
            properties: r.payload ? JSON.parse(r.payload) : {} 
        }));

        res.json(items);
    } catch (error) {
        console.error("Error fetching events:", error.message);
        res.status(500).json({ error: 'Failed to fetch events from database.' });
    }
});

// ✅ 2. 查詢所有測驗結果 (GET /api/results) - 供 admin.html 讀取
app.get('/api/results', (req, res) => {
    try {
        const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
        const limit = Math.min(Number(pageSize) || 100, 500);
        const offset = (Number(page) - 1) * limit;

        const params = {
            // 使用 dayjs 確保日期範圍包含整天
            start: start ? dayjs(start).startOf('day').toISOString() : null,
            end: end ? dayjs(end).endOf('day').toISOString() : null,
            limit,
            offset
        };

        const items = stQueryResults.all(params).map(r => ({
            id: r.id,
            timestamp: r.ts,
            user_id: r.session_id,
            session_id: r.session_id,
            result: r.result_name,
            // 關鍵修正：將 score_json 字符串解析為 JS Object
            scores: r.score_json ? JSON.parse(r.score_json) : {} 
        }));

        res.json(items);
    } catch (error) {
        console.error("Error fetching results:", error.message);
        res.status(500).json({ error: 'Failed to fetch quiz results from database.' });
    }
});

// 3. 接收事件 POST - 供前端上傳數據
app.post('/api/events', (req, res) => {
    try {
        const now = new Date().toISOString();
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const session_id = req.cookies.session_id;
        const body = req.body || {};

        const items = Array.isArray(body.batch) ? body.batch : [body];
        
        // 使用事務 (Transaction) 提高批量寫入性能
        const insertMany = db.transaction((arr) => {
            for (const it of arr) {
                const page = it.page || it.properties?.page || '';
                const type = it.type || it.event || (it.properties?.event) || 'custom';
                const payload = it.payload || it.properties || {};

                stInsertEvent.run({
                    id: nanoid(),
                    ts: now,
                    session_id,
                    ip: String(ip),
                    page: String(page),
                    type: String(type),
                    payload: JSON.stringify(payload)
                });
            }
        });

        insertMany(items);
        res.json({ ok: true, inserted: items.length });
    } catch (error) {
        console.error("Error inserting events:", error.message);
        res.status(500).json({ error: 'Failed to insert events.' });
    }
});

// 4. 儲存測驗結果 POST - 供前端上傳數據
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
    } catch (error) {
        console.error("Error inserting result:", error.message);
        res.status(500).json({ error: 'Failed to insert quiz result.' });
    }
});

// ✅ 5. Dashboard 數據統計 API (GET /api/dashboard) - 供 dashboard.html 使用
app.get('/api/dashboard', (req, res) => {
    try {
        const today = dayjs().startOf('day').toISOString();
        const now = dayjs().toISOString();

        // 總事件數
        const totalEvents = db.prepare(`
            SELECT COUNT(*) as count FROM events
        `).get();

        // 總用戶數 (不重複的 session_id)
        const totalUsers = db.prepare(`
            SELECT COUNT(DISTINCT session_id) as count FROM events
        `).get();

        // 總會話數
        const totalSessions = db.prepare(`
            SELECT COUNT(DISTINCT session_id) as count FROM events
        `).get();

        // 今日事件數
        const todayEvents = db.prepare(`
            SELECT COUNT(*) as count FROM events WHERE ts >= ?
        `).get(today);

        // 今日用戶數
        const todayUsers = db.prepare(`
            SELECT COUNT(DISTINCT session_id) as count FROM events WHERE ts >= ?
        `).get(today);

        // 熱門事件
        const topEvents = db.prepare(`
            SELECT type as event_name, COUNT(*) as count 
            FROM events 
            GROUP BY type 
            ORDER BY count DESC 
            LIMIT 6
        `).all();

        // 頁面瀏覽統計
        const pageViews = db.prepare(`
            SELECT page, COUNT(*) as count 
            FROM events 
            WHERE type = 'page_view' 
            GROUP BY page 
            ORDER BY count DESC 
            LIMIT 10
        `).all();

        // 測驗結果分布
        const quizResults = db.prepare(`
            SELECT result_name as result, COUNT(*) as count 
            FROM results 
            GROUP BY result_name 
            ORDER BY count DESC
        `).all();

        // 今日每小時事件趨勢
        const hourlyEvents = db.prepare(`
            SELECT strftime('%H', ts) as hour, COUNT(*) as count 
            FROM events 
            WHERE ts >= ? 
            GROUP BY strftime('%H', ts) 
            ORDER BY hour
        `).all(today);

        res.json({
            totalEvents: [totalEvents],
            totalUsers: [totalUsers],
            totalSessions: [totalSessions],
            todayEvents: [todayEvents],
            todayUsers: [todayUsers],
            topEvents,
            pageViews,
            quizResults,
            hourlyEvents
        });
    } catch (error) {
        console.error("Error fetching dashboard data:", error.message);
        res.status(500).json({ error: 'Failed to fetch dashboard data.' });
    }
});

// ✅ 6. 實時數據 API (GET /api/realtime) - 供 dashboard.html 使用
app.get('/api/realtime', (req, res) => {
    try {
        const fiveMinutesAgo = dayjs().subtract(5, 'minute').toISOString();
        const now = dayjs().toISOString();

        // 最近5分鐘事件數
        const recentEvents = db.prepare(`
            SELECT COUNT(*) as count FROM events WHERE ts >= ?
        `).get(fiveMinutesAgo);

        // 在線用戶數 (最近5分鐘有活動的用戶)
        const onlineUsers = db.prepare(`
            SELECT COUNT(DISTINCT session_id) as count FROM events WHERE ts >= ?
        `).get(fiveMinutesAgo);

        // 最近事件列表
        const recentEventList = db.prepare(`
            SELECT event_name, timestamp, user_id, page 
            FROM (
                SELECT type as event_name, ts as timestamp, session_id as user_id, page
                FROM events 
                ORDER BY ts DESC 
                LIMIT 20
            )
        `).all();

        res.json({
            recentEvents: [recentEvents],
            onlineUsers: [onlineUsers],
            recentEventList: recentEventList.map(item => ({
                event_name: item.event_name,
                timestamp: item.timestamp,
                user_id: item.user_id,
                page: item.page
            }))
        });
    } catch (error) {
        console.error("Error fetching realtime data:", error.message);
        res.status(500).json({ error: 'Failed to fetch realtime data.' });
    }
});

// ---------- 頁面路由 ----------
// 首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// 測驗頁面
app.get('/quiz', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'quiz.html'));
});

// 結果頁面
app.get('/result', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'result.html'));
});

// Dashboard 監控頁面
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'dashboard.html'));
});

// 後台管理頁面
app.get('/admin', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'admin.html'));
});

// 測試頁面
app.get('/test', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'test.html'));
});

// ---------- 靜態文件服務 (必須在 API 路由之後) ----------
app.use(express.static(ROOT_DIR));
app.use('/public', express.static(PUBLIC_DIR));

// ---------- 啟動伺服器 ----------
app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`📂 DB File: ${DB_FILE}`);
    console.log(`\n📄 可用頁面:`);
    console.log(`   • 首頁: http://localhost:${PORT}/`);
    console.log(`   • 測驗: http://localhost:${PORT}/quiz`);
    console.log(`   • 結果: http://localhost:${PORT}/result`);
    console.log(`   • 監控: http://localhost:${PORT}/dashboard`);
    console.log(`   • 管理: http://localhost:${PORT}/admin`);
    console.log(`   • 測試: http://localhost:${PORT}/test`);
    console.log(`\n🔧 API 端點:`);
    console.log(`   • 健康檢查: http://localhost:${PORT}/api/health`);
    console.log(`   • 事件查詢: http://localhost:${PORT}/api/events`);
    console.log(`   • 結果查詢: http://localhost:${PORT}/api/results`);
    console.log(`   • Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`   • 實時數據: http://localhost:${PORT}/api/realtime`);
    console.log(`======================================================\n`);
});