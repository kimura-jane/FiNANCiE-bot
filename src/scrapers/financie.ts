// src/scrapers/financie.ts

import { Page } from 'playwright';
import { FinancieMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * 数値文字列をパース（カンマ区切り対応）
 */
const parseNumber = (text: string | null): number => {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
};

/**
 * 相対時間テキストから24時間以内かどうか判定
 */
const isWithin24Hours = (timeText: string): boolean => {
  if (!timeText) return false;
  
  const text = timeText.trim();
  
  // 「分前」「時間前」→ 24時間以内
  if (text.includes('分前') || text.includes('時間前')) {
    return true;
  }
  
  // 「1日前」→ 24時間以内の可能性があるのでActive扱い
  if (text === '1日前' || text.includes('1日前')) {
    return true;
  }
  
  // 「秒前」「たった今」→ 24時間以内
  if (text.includes('秒前') || text.includes('たった今') || text.includes('今')) {
    return true;
  }
  
  // 「2日前」以降、または日付形式 → 24時間外
  return false;
};

/**
 * FiNANCiEプロフィールページからメトリクスを取得
 */
export const scrapeFinancie = async (
  page: Page,
  url: string
): Promise<ScrapeResult<FinancieMetrics>> => {
  try {
    logger.info(`Scraping FiNANCiE: ${url}`);
    
    // ========== Step 1: ホームページでサポーター数を取得 ==========
    await page.goto(url, { waitUntil: 'networkidle' });
    await randomDelay(3, 5);
    
    // サポーター数を取得
    let supporters = 0;
    try {
      const supportersEl = await page.$('.profile_databox .profile_num span span');
      if (supportersEl) {
        const text = await supportersEl.textContent();
        supporters = parseNumber(text);
        logger.info(`Found supporters: ${supporters}`);
      }
      
      // フォールバック
      if (supporters === 0) {
        const pageContent = await page.content();
        const match = pageContent.match(/(\d[\d,]*)\s*(メンバー|人|サポーター)/);
        if (match) {
          supporters = parseNumber(match[1]);
          logger.info(`Found supporters from text: ${supporters}`);
        }
      }
    } catch (e) {
      logger.warn('Failed to get supporters count');
    }

    // ========== Step 2: 活動報告リンクを取得 ==========
    let activityLogUrl = '';
    try {
      const newsLink = await page.$('a[data-tab-name="news"]');
      if (newsLink) {
        const href = await newsLink.getAttribute('href');
        if (href) {
          activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
          logger.info(`Found activity log URL: ${activityLogUrl}`);
        }
      }
      
      // フォールバック
      if (!activityLogUrl) {
        const altLink = await page.$('a[href*="/activity_log"]');
        if (altLink) {
          const href = await altLink.getAttribute('href');
          if (href) {
            activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to get activity log link');
    }

    // ========== Step 3: 活動報告ページで最新投稿時間を取得 ==========
    let lastPostTime: string | null = '不明';
    let isActive = false;
    
    if (activityLogUrl) {
      await randomDelay(5, 8);
      
      try {
        await page.goto(activityLogUrl, { waitUntil: 'networkidle' });
        await randomDelay(2, 4);
        
        // 最新投稿の時間テキストを取得（複数のセレクターを試す）
        const timeSelectors = [
          '.feed-item time',
          '.activity-item time',
          '[class*="feed"] time',
          '[class*="activity"] time',
          '[class*="post"] time',
          'time',
          '[class*="time"]',
          '[class*="date"]',
        ];
        
        for (const selector of timeSelectors) {
          try {
            const timeEl = await page.$(selector);
            if (timeEl) {
              const text = await timeEl.textContent();
              if (text && text.trim()) {
                lastPostTime = text.trim();
                logger.info(`Found time with selector "${selector}": ${lastPostTime}`);
                break;
              }
            }
          } catch (e) {
            // 次のセレクターを試す
          }
        }
        
        // フォールバック: ページ内テキストから「〇〇前」を探す
        if (lastPostTime === '不明') {
          const pageContent = await page.content();
          const timePatterns = [
            /(\d+秒前)/,
            /(\d+分前)/,
            /(\d+時間前)/,
            /(\d+日前)/,
            /(たった今)/,
          ];
          
          for (const pattern of timePatterns) {
            const match = pageContent.match(pattern);
            if (match) {
              lastPostTime = match[1];
              logger.info(`Found time from text: ${lastPostTime}`);
              break;
            }
          }
        }
        
        // 24時間以内かどうか判定
        isActive = isWithin24Hours(lastPostTime);
        logger.info(`Active status: ${isActive ? '◎ Active' : '× Inactive'} (${lastPostTime})`);
        
      } catch (e) {
        logger.warn(`Failed to scrape activity log: ${e}`);
      }
    } else {
      logger.warn('Activity log URL not found');
    }
    
    logger.info(`FiNANCiE final result: supporters=${supporters}, lastPost="${lastPostTime}", active=${isActive}`);
    
    return {
      success: true,
      data: { 
        supporters, 
        totalPosts: 0,
        lastPostTime, 
        isActive 
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`FiNANCiE scrape failed: ${url}`, { error: errorMessage });
    
    return {
      success: false,
      error: errorMessage,
    };
  }
};
