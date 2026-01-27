// src/scrapers/x.ts
// Xの自動取得は無効化。手動入力に変更。

import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';

export const scrapeX = async (
  xId: string
): Promise<ScrapeResult<XMetrics>> => {
  logger.info(`X auto-scraping disabled. Manual input required for: ${xId}`);
  
  return {
    success: false,
    error: 'Auto-scraping disabled',
  };
};
