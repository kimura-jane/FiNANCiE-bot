/**
 * オーナー情報（Ownersシートから取得）
 */
export interface Owner {
  name: string;
  financieUrl: string;
  xId: string;
}

/**
 * FiNANCiEから取得するメトリクス
 */
export interface FinancieMetrics {
  supporters: number;      // サポーター数（コミュニティメンバー数）
  totalPosts: number;      // フィード総投稿数
}

/**
 * Xから取得するメトリクス
 */
export interface XMetrics {
  followers: number;       // フォロワー数
  totalPosts: number;      // 総ポスト数
}

/**
 * 1オーナーの全メトリクス（1日分）
 */
export interface DailyMetrics {
  date: string;            // YYYY-MM-DD形式
  name: string;
  financie: FinancieMetrics;
  x: XMetrics;
}

/**
 * デルタ（前日比）を含むスコアデータ
 */
export interface ScoredMetrics extends DailyMetrics {
  delta: {
    financiePosts: number;
    xPosts: number;
    supporters: number;
    followers: number;
  };
  score: number;
}

/**
 * スクレイピング結果
 */
export interface ScrapeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
