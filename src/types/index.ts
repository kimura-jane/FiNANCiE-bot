// src/types/index.ts

export interface Owner {
  name: string;
  financieUrl: string | null;
  xId: string | null;
}

export interface FinancieMetrics {
  supporters: number;
  weeklyPosts: number;
  lastPostTime: string | null;
}

export interface XMetrics {
  followers: number;
  totalPosts: number;
  updatedAt: string | null;  // X入力日を追加
}

export interface DailyMetrics {
  date: string;
  name: string;
  financie: FinancieMetrics;
  x: XMetrics;
}

export interface DeltaMetrics {
  supporters: number;
  weeklyPosts: number;
}

export interface ScoredMetrics extends DailyMetrics {
  delta: DeltaMetrics;
  score: number;
}

export interface ScrapeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// X履歴用の型（一日平均計算用）
export interface XHistoryEntry {
  date: string;
  followers: number;
  posts: number;
  updatedAt: string;
}

// 一日平均の計算結果
export interface XDailyAverage {
  avgFollowersPerDay: number;  // 一日平均フォロワー増加
  avgPostsPerDay: number;      // 一日平均ポスト数
  totalDays: number;           // 計測日数
  latestFollowers: number;     // 最新フォロワー数
  latestPosts: number;         // 最新ポスト数
}
