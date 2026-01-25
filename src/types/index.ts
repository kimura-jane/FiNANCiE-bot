// src/types/index.ts

export interface Owner {
  name: string;
  financieUrl: string | null;
  xId: string | null;
}

export interface FinancieMetrics {
  supporters: number;
  totalPosts: number;
  isActive: boolean;
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
  financieActive: boolean;
  xPosts: number;
  supporters: number;
  followers: number;
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
