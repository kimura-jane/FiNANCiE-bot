import { Page, Response } from 'playwright';
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
 * APIインターセプトで投稿数を取得
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
      
      // フォールバック: ページ内テキストから検索
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
    let communityId = '';
    try {
      const newsLink = await page.$('a[data-tab-name="news"]');
      if (newsLink) {
        const href = await newsLink.getAttribute('href');
        if (href) {
          activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
          // community IDを抽出 (例: /communities/443/activity_log -> 443)
          const idMatch = href.match(/\/communities\/(\d+)/);
          if (idMatch) {
            communityId = idMatch[1];
          }
          logger.info(`Found activity log URL: ${activityLogUrl}, community ID: ${communityId}`);
        }
      }
      
      // フォールバック
      if (!activityLogUrl) {
        const altLink = await page.$('a[href*="/activity_log"]');
        if (altLink) {
          const href = await altLink.getAttribute('href');
          if (href) {
            activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
            const idMatch = href.match(/\/communities\/(\d+)/);
            if (idMatch) {
              communityId = idMatch[1];
            }
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to get activity log link');
    }

    // ========== Step 3: APIインターセプトで投稿数を取得 ==========
    let totalPosts = 0;
    if (activityLogUrl && communityId) {
      await randomDelay(5, 8);
      
      try {
        // APIレスポンスをキャッチするPromiseを設定
        const apiResponsePromise = page.waitForResponse(
          (response: Response) => {
            const url = response.url();
            return url.includes(`/api/v1/communities/${communityId}/activity_logs`) ||
                   url.includes(`/api/`) && url.includes('activity');
          },
          { timeout: 15000 }
        ).catch(() => null);
        
        // ページに遷移
        await page.goto(activityLogUrl, { waitUntil: 'domcontentloaded' });
        
        // APIレスポンスを待つ
        const apiResponse = await apiResponsePromise;
        
        if (apiResponse) {
          try {
            const jsonData = await apiResponse.json();
            logger.info(`API response received`);
            
            // total_count を探す（様々なパターンに対応）
            if (jsonData.total_count !== undefined) {
              totalPosts = jsonData.total_count;
            } else if (jsonData.data?.total_count !== undefined) {
              totalPosts = jsonData.data.total_count;
            } else if (jsonData.meta?.total_count !== undefined) {
              totalPosts = jsonData.meta.total_count;
            } else if (jsonData.total !== undefined) {
              totalPosts = jsonData.total;
            } else if (Array.isArray(jsonData.data)) {
              // 配列の場合はlengthを使用（ただし1ページ分のみ）
              totalPosts = jsonData.data.length;
              logger.info(`Using array length as posts count`);
            }
            
            logger.info(`Found posts from API: ${totalPosts}`);
          } catch (jsonError) {
            logger.warn(`Failed to parse API JSON: ${jsonError}`);
          }
        } else {
          logger.warn('API response not captured, trying fallback');
          
          // フォールバック: ページ上の投稿アイテムをカウント
          await randomDelay(2, 3);
          const postItems = await page.$$('article, [class*="activity-item"], [class*="post-item"], [class*="feed-item"]');
          if (postItems.length > 0) {
            totalPosts = postItems.length;
            logger.info(`Counted visible posts: ${totalPosts}`);
          }
        }
      } catch (e) {
        logger.warn(`Failed to scrape activity log: ${e}`);
      }
    } else {
      logger.warn('Activity log URL not found, skipping posts count');
    }
    
    logger.info(`FiNANCiE final result: supporters=${supporters}, posts=${totalPosts}`);
    
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
