// src/types/index.ts

/**
 * スプレッドシートのOwnersシートから読み込むオーナー情報
 */
export interface Owner {
  name: string;
  financieUrl: string | null;
  xId: string | null;
}

/**
 * FiNANCiEから取得するメトリクス
 */
export interface FinancieMetrics {
  /** サポーター数（コミュニティメンバー数） */
  supporters: number;
  /** 総投稿数（参考値、正確な取得が難しい場合がある） */
  totalPosts: number;
  /** 24時間以内に投稿があったか */
  isActive: boolean;
  /** 最新投稿の相対時間（例: "3時間前", "1日前"） */
  lastPostTime: string | null;
}

/**
 * Xから取得するメトリクス
 */
export interface XMetrics {
  /** フォロワー数 */
  followers: number;
  /** 総ポスト数（ツイート数） */
  totalPosts: number;
}

/**
 * 1日分のメトリクス（スプレッドシートのHistoryシートに保存）
 */
export interface DailyMetrics {
  /** 日付（YYYY-MM-DD形式） */
  date: string;
  /** オーナー名 */
  name: string;
  /** FiNANCiEのメトリクス */
  financie: FinancieMetrics;
  /** Xのメトリクス */
  x: XMetrics;
}

/**
 * 前日比の差分データ
 */
export interface DeltaMetrics {
  /** FiNANCiEが24時間以内にアクティブか */
  financieActive: boolean;
  /** X投稿数の増加分 */
  xPosts: number;
  /** サポーター数の増加分 */
  supporters: number;
  /** フォロワー数の増加分 */
  followers: number;
}

/**
 * スコア計算済みのメトリクス（スプレッドシートのRankingシートに保存）
 */
export interface ScoredMetrics extends DailyMetrics {
  /** 前日比の差分 */
  delta: DeltaMetrics;
  /** 計算されたスコア */
  score: number;
}

/**
 * スクレイピング結果の共通インターフェース
 */
export interface ScrapeResult<T> {
  /** 成功したか */
  success: boolean;
  /** 取得したデータ（成功時） */
  data?: T;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/**
 * FiNANCiEスクレイピング結果
 */
export type FinancieScrapeResult = ScrapeResult<FinancieMetrics>;

/**
 * Xスクレイピング結果
 */
export type XScrapeResult = ScrapeResult<XMetrics>;

/**
 * Syndication APIからのレスポンス（X版A案）
 */
export interface XSyndicationResponse {
  /** ユーザーID（内部ID） */
  id: number;
  /** スクリーンネーム（@なし） */
  screen_name: string;
  /** フォロワー数 */
  followers_count: number;
  /** 総ツイート数 */
  statuses_count: number;
}
