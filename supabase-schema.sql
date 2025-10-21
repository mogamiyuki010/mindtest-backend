-- Supabase 數據庫表結構
-- 在 Supabase Dashboard 的 SQL Editor 中執行此腳本

-- 創建 events 表
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  session_id TEXT,
  ip TEXT,
  page TEXT,
  type TEXT,
  payload JSONB
);

-- 創建 results 表
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  session_id TEXT,
  result_name TEXT,
  score_json JSONB
);

-- 創建索引以提高查詢性能
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_results_ts ON results(ts);
CREATE INDEX IF NOT EXISTS idx_results_session_id ON results(session_id);

-- 啟用 Row Level Security (RLS)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

-- 創建 RLS 策略 - 允許所有操作（根據需要調整）
CREATE POLICY "Allow all operations on events" ON events FOR ALL USING (true);
CREATE POLICY "Allow all operations on results" ON results FOR ALL USING (true);

-- 創建函數來創建表（如果不存在）
CREATE OR REPLACE FUNCTION create_events_table()
RETURNS void AS $$
BEGIN
  -- 表已經存在，不需要創建
  RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_results_table()
RETURNS void AS $$
BEGIN
  -- 表已經存在，不需要創建
  RETURN;
END;
$$ LANGUAGE plpgsql;
