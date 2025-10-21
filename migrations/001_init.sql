-- 事件資料表：前端行為
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,               -- ISO time
  session_id TEXT,                -- cookie/session
  ip TEXT,
  page TEXT,
  type TEXT,                      -- page_view, option_select, quiz_complete...
  payload TEXT                    -- JSON 字串
);

-- 測驗結果表
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT,
  result_name TEXT,
  score_json TEXT                 -- JSON 字串（各向度分數）
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_results_ts ON results(ts);
