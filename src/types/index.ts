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
