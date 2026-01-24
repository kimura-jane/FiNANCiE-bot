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
 * FiNANCiEプロフィールページからメトリクスを取得
 * 2段階アクセス: ホーム → 活動報告
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
      // セレクター: メンバー数の部分
      const supportersEl = await page.$('.profile_databox .profile_num span span');
      if (supportersEl) {
        const text = await supportersEl.textContent();
        supporters = parseNumber(text);
        logger.info(`Found supporters: ${supporters}`);
      } else {
        // フォールバック: 別のセレクターを試す
        const altEl = await page.$('[class*="member"] [class*="num"], [class*="supporter"] [class*="count"]');
        if (altEl) {
          const text = await altEl.textContent();
          supporters = parseNumber(text);
        }
      }
      
      // さらにフォールバック: ページ内テキストから検索
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
      // data-tab-name="news" の href を取得
      const newsLink = await page.$('a[data-tab-name="news"]');
      if (newsLink) {
        const href = await newsLink.getAttribute('href');
        if (href) {
          activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
          logger.info(`Found activity log URL: ${activityLogUrl}`);
        }
      }
      
      // フォールバック: 「活動報告」テキストを含むリンクを探す
      if (!activityLogUrl) {
        const altLink = await page.$('a[href*="/activity_log"], a:has-text("活動報告")');
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

    // ========== Step 3: 活動報告ページで投稿数を取得 ==========
    let totalPosts = 0;
    if (activityLogUrl) {
      await randomDelay(5, 8);
      
      try {
        await page.goto(activityLogUrl, { waitUntil: 'networkidle' });
        await randomDelay(2, 4);
        
        // 投稿数を探す（複数のパターンを試す）
        const pageContent = await page.content();
        
        // パターン1: "XX件" の形式
        const matchKen = pageContent.match(/(\d[\d,]*)\s*件/);
        if (matchKen) {
          totalPosts = parseNumber(matchKen[1]);
          logger.info(`Found posts (件): ${totalPosts}`);
        }
        
        // パターン2: "投稿 XX" の形式
        if (totalPosts === 0) {
          const matchPost = pageContent.match(/投稿\s*[:：]?\s*(\d[\d,]*)/);
          if (matchPost) {
            totalPosts = parseNumber(matchPost[1]);
            logger.info(`Found posts (投稿): ${totalPosts}`);
          }
        }
        
        // パターン3: 投稿アイテムの数をカウント
        if (totalPosts === 0) {
          const postItems = await page.$$('[class*="activity"], [class*="post"], [class*="feed"] > div');
          if (postItems.length > 0) {
            totalPosts = postItems.length;
            logger.info(`Counted post items: ${totalPosts}`);
          }
        }
      } catch (e) {
        logger.warn(`Failed to scrape activity log: ${e}`);
      }
    } else {
      logger.warn('Activity log URL not found, skipping posts count');
    }
    
    logger.info(`FiNANCiE result: supporters=${supporters}, posts=${totalPosts}`);
    
    return {
      success: true,
      data: { supporters, totalPosts },
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
