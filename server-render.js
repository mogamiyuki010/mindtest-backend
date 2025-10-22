import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { nanoid } from 'nanoid';
import dayjs from 'dayjs';
import { createClient } from '@supabase/supabase-js';

// 載入環境變數
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

// 創建 Supabase 客戶端
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 配置
app.use(cors({
    origin: [
        "https://mogamiyuki010.github.io",
        "https://mogamiyuki010.github.io/mindtest",
        "https://mogamiyuki010.github.io/mindtest/",
        "http://localhost:3000",
        "https://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 200
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Session ID 中介層
app.use((req, res, next) => {
    if (!req.cookies.session_id) {
        res.cookie('session_id', nanoid(), { maxAge: 10 * 24 * 3600 * 1000, httpOnly: true }); 
    }
    next();
});

// 健康檢查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: 'supabase'
    });
});

// 查詢事件
app.get('/api/events', async (req, res) => {
    try {
        const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
        const limit = Math.min(Number(pageSize) || 100, 500);
        const offset = (Number(page) - 1) * limit;

        let query = supabase.from('events').select('*');
        
        if (start) query = query.gte('ts', start);
        if (end) query = query.lte('ts', end);
        
        const { data, error } = await query
            .order('ts', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) throw error;
        
        const items = (data || []).map(r => ({
            id: r.id,
            timestamp: r.ts,
            event_name: r.type,
            user_id: r.session_id, 
            session_id: r.session_id,
            page: r.page,
            properties: r.payload || {}
        }));

        res.json(items);
    } catch (error) {
        console.error("Error fetching events:", error.message);
        res.status(500).json({ error: 'Failed to fetch events from database.' });
    }
});

// 查詢結果
app.get('/api/results', async (req, res) => {
    try {
        const { start = null, end = null, page = 1, pageSize = 100 } = req.query;
        const limit = Math.min(Number(pageSize) || 100, 500);
        const offset = (Number(page) - 1) * limit;

        let query = supabase.from('results').select('*');
        
        if (start) query = query.gte('ts', start);
        if (end) query = query.lte('ts', end);
        
        const { data, error } = await query
            .order('ts', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) throw error;
        
        const items = (data || []).map(r => ({
            id: r.id,
            timestamp: r.ts,
            user_id: r.session_id,
            session_id: r.session_id,
            result: r.result_name,
            scores: r.score_json || {}
        }));

        res.json(items);
    } catch (error) {
        console.error("Error fetching results:", error.message);
        res.status(500).json({ error: 'Failed to fetch quiz results from database.' });
    }
});

// 接收事件
app.post('/api/events', async (req, res) => {
    try {
        const now = new Date().toISOString();
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const session_id = req.cookies.session_id;
        const body = req.body || {};

        const items = Array.isArray(body.batch) ? body.batch : [body];
        
        for (const it of items) {
            const page = it.page || it.properties?.page || '';
            const type = it.type || it.event || (it.properties?.event) || 'custom';
            const payload = it.payload || it.properties || {};

            const eventData = {
                id: nanoid(),
                ts: now,
                session_id,
                ip: String(ip),
                page: String(page),
                type: String(type),
                payload: JSON.stringify(payload)
            };

            const { error } = await supabase
                .from('events')
                .insert([eventData]);
            
            if (error) {
                console.error('Supabase 插入事件失敗:', error);
            }
        }

        res.json({ ok: true, inserted: items.length });
    } catch (error) {
        console.error("Error inserting events:", error.message);
        res.status(500).json({ error: 'Failed to insert events.' });
    }
});

// 儲存結果
app.post('/api/results', async (req, res) => {
    try {
        const now = new Date().toISOString();
        const session_id = req.cookies.session_id;
        const { result_name = '', scores = {} } = req.body || {};

        const resultData = {
            id: nanoid(),
            ts: now,
            session_id,
            result_name: String(result_name),
            score_json: JSON.stringify(scores)
        };

        const { error } = await supabase
            .from('results')
            .insert([resultData]);
        
        if (error) {
            console.error('Supabase 插入結果失敗:', error);
        }

        res.json({ ok: true });
    } catch (error) {
        console.error("Error inserting result:", error.message);
        res.status(500).json({ error: 'Failed to insert quiz result.' });
    }
});

// Dashboard 數據
app.get('/api/dashboard', async (req, res) => {
    try {
        const today = dayjs().startOf('day').toISOString();

        // 總事件數
        const { count: totalEvents } = await supabase
            .from('events')
            .select('*', { count: 'exact', head: true });

        // 總用戶數
        const { data: usersData } = await supabase
            .from('events')
            .select('session_id')
            .not('session_id', 'is', null);
        
        const uniqueUsers = new Set(usersData?.map(u => u.session_id) || []).size;

        // 今日事件數
        const { count: todayEvents } = await supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .gte('ts', today);

        // 熱門事件
        const { data: topEventsData } = await supabase
            .from('events')
            .select('type')
            .not('type', 'is', null);
        
        const eventCounts = {};
        topEventsData?.forEach(event => {
            eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
        });
        
        const topEvents = Object.entries(eventCounts)
            .map(([event_name, count]) => ({ event_name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);

        // 測驗結果分布
        const { data: resultsData } = await supabase
            .from('results')
            .select('result_name')
            .not('result_name', 'is', null);
        
        const resultCounts = {};
        resultsData?.forEach(result => {
            resultCounts[result.result_name] = (resultCounts[result.result_name] || 0) + 1;
        });
        
        const quizResults = Object.entries(resultCounts)
            .map(([result, count]) => ({ result, count }))
            .sort((a, b) => b.count - a.count);

        res.json({
            totalEvents: [{ count: totalEvents || 0 }],
            totalUsers: [{ count: uniqueUsers }],
            totalSessions: [{ count: uniqueUsers }],
            todayEvents: [{ count: todayEvents || 0 }],
            todayUsers: [{ count: uniqueUsers }],
            topEvents,
            pageViews: [],
            quizResults,
            hourlyEvents: []
        });
    } catch (error) {
        console.error("Error fetching dashboard data:", error.message);
        res.status(500).json({ error: 'Failed to fetch dashboard data.' });
    }
});

// 實時數據
app.get('/api/realtime', async (req, res) => {
    try {
        const fiveMinutesAgo = dayjs().subtract(5, 'minute').toISOString();

        // 最近5分鐘事件數
        const { count: recentEvents } = await supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .gte('ts', fiveMinutesAgo);

        // 在線用戶數
        const { data: onlineData } = await supabase
            .from('events')
            .select('session_id')
            .gte('ts', fiveMinutesAgo)
            .not('session_id', 'is', null);
        
        const onlineUsers = new Set(onlineData?.map(u => u.session_id) || []).size;

        // 最近事件列表
        const { data: recentEventList } = await supabase
            .from('events')
            .select('type, ts, session_id, page')
            .order('ts', { ascending: false })
            .limit(20);

        res.json({
            recentEvents: [{ count: recentEvents || 0 }],
            onlineUsers: [{ count: onlineUsers }],
            recentEventList: (recentEventList || []).map(item => ({
                event_name: item.type,
                timestamp: item.ts,
                user_id: item.session_id,
                page: item.page
            }))
        });
    } catch (error) {
        console.error("Error fetching realtime data:", error.message);
        res.status(500).json({ error: 'Failed to fetch realtime data.' });
    }
});

// 獲取用戶結果
app.get('/api/user-results', async (req, res) => {
    try {
        const session_id = req.cookies.session_id;
        if (!session_id) {
            return res.status(400).json({ error: 'Session ID required' });
        }

        const { data, error } = await supabase
            .from('results')
            .select('*')
            .eq('session_id', session_id)
            .order('ts', { ascending: false });
        
        if (error) throw error;

        const formattedResults = (data || []).map(r => ({
            id: r.id,
            timestamp: r.ts,
            result_name: r.result_name,
            scores: r.score_json || {}
        }));

        res.json({
            session_id,
            results: formattedResults,
            total: formattedResults.length
        });
    } catch (error) {
        console.error("Error fetching user results:", error.message);
        res.status(500).json({ error: 'Failed to fetch user results.' });
    }
});

// 啟動服務器
app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`✅ API Server running at http://localhost:${PORT}`);
    console.log(`🌐 Supabase URL: ${supabaseUrl}`);
    console.log(`\n🔧 API 端點:`);
    console.log(`   • 健康檢查: http://localhost:${PORT}/api/health`);
    console.log(`   • 事件查詢: http://localhost:${PORT}/api/events`);
    console.log(`   • 結果查詢: http://localhost:${PORT}/api/results`);
    console.log(`   • Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`   • 實時數據: http://localhost:${PORT}/api/realtime`);
    console.log(`======================================================\n`);
});
