import { Page } from 'playwright';
import { FINANCIE_SELECTORS } from '../config/selectors';
import { FinancieMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * 数値文字列をパース（カンマ区切り対応）
 */
const parseNumber = (text: string | null): number => {
  if (!text) return 0;
  // 数字以外を除去してパース
  const cleaned = text.replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
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
    
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // ページ読み込み待機
    await page.waitForSelector(FINANCIE_SELECTORS.PAGE_LOADED, { timeout: 15000 })
      .catch(() => logger.warn('Page load selector not found, continuing...'));
    
    // 追加の待機（動的コンテンツ対策）
    await randomDelay(2, 4);
    
    // サポーター数を取得
    let supporters = 0;
    try {
      const supportersEl = await page.$(FINANCIE_SELECTORS.SUPPORTERS);
      if (supportersEl) {
        const text = await supportersEl.textContent();
        supporters = parseNumber(text);
      } else {
        // フォールバック: ページ内テキストから検索
        const pageContent = await page.content();
        const match = pageContent.match(/(\d[\d,]*)\s*(メンバー|サポーター|人)/);
        if (match) {
          supporters = parseNumber(match[1]);
        }
      }
    } catch (e) {
      logger.warn('Failed to get supporters count');
    }
    
    // 総投稿数を取得
    let totalPosts = 0;
    try {
      const postsEl = await page.$(FINANCIE_SELECTORS.TOTAL_POSTS);
      if (postsEl) {
        const text = await postsEl.textContent();
        totalPosts = parseNumber(text);
      } else {
        // フォールバック: フィードタブや投稿数表示を探す
        const pageContent = await page.content();
        const match = pageContent.match(/(\d[\d,]*)\s*(投稿|件|posts?)/i);
        if (match) {
          totalPosts = parseNumber(match[1]);
        }
      }
    } catch (e) {
      logger.warn('Failed to get total posts count');
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
