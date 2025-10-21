// Supabase 配置
import { createClient } from '@supabase/supabase-js';

// 從環境變數獲取 Supabase 配置
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

// 創建 Supabase 客戶端
export const supabase = createClient(supabaseUrl, supabaseKey);

// 數據庫表名
export const TABLES = {
  EVENTS: 'events',
  RESULTS: 'results'
};

// 初始化 Supabase 表結構
export async function initSupabaseTables() {
  try {
    // 創建 events 表
    const { error: eventsError } = await supabase.rpc('create_events_table');
    if (eventsError && !eventsError.message.includes('already exists')) {
      console.error('創建 events 表失敗:', eventsError);
    }

    // 創建 results 表
    const { error: resultsError } = await supabase.rpc('create_results_table');
    if (resultsError && !resultsError.message.includes('already exists')) {
      console.error('創建 results 表失敗:', resultsError);
    }

    console.log('✅ Supabase 表結構初始化完成');
  } catch (error) {
    console.error('❌ Supabase 初始化失敗:', error);
  }
}

export default supabase;
