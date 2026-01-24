import { Page } from 'playwright';
import { X_SELECTORS } from '../config/selectors';
import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * 数値文字列をパース（K/M表記対応）
 */
const parseNumber = (text: string | null): number => {
  if (!text) return 0;
  
  const cleaned = text.trim().toLowerCase();
  
  if (cleaned.includes('k')) {
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return Math.round(num * 1000);
  }
  if (cleaned.includes('m')) {
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return Math.round(num * 1000000);
  }
  
  return parseInt(cleaned.replace(/[^0-9]/g, ''), 10) || 0;
};

/**
 * XプロフィールURLを正規化
 */
const normalizeXUrl = (idOrUrl: string): string => {
  if (idOrUrl.startsWith('http')) {
    return idOrUrl;
  }
  const username = idOrUrl.replace(/^@/, '');
  return `https://x.com/${username}`;
};

/**
 * Xプロフィールページからメトリクスを取得
 */
export const scrapeX = async (
  page: Page,
  idOrUrl: string
): Promise<ScrapeResult<XMetrics>> => {
  const url = normalizeXUrl(idOrUrl);
  
  try {
    logger.info(`Scraping X: ${url}`);
    
    // ページ遷移（エラーハンドリング強化）
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // HTTPステータスをチェック
    if (response) {
      const status = response.status();
      logger.info(`X response status: ${status}`);
      
      if (status === 403) {
        logger.error('X returned 403 Forbidden - IP is blocked');
        return { success: false, error: '403 Forbidden - IP blocked by X' };
      }
      if (status === 429) {
        logger.error('X returned 429 Too Many Requests - Rate limited');
        return { success: false, error: '429 Rate limited' };
      }
      if (status >= 400) {
        logger.error(`X returned error status: ${status}`);
        return { success: false, error: `HTTP ${status}` };
      }
    }
    
    // ページ読み込み待機
    await randomDelay(3, 6);
    
    // ログインモーダルやエラー画面のチェック
    const pageContent = await page.content();
    if (pageContent.includes('Something went wrong') || 
        pageContent.includes('この情報は利用できません') ||
        pageContent.includes('Try again')) {
      logger.warn('X page shows error message');
      return { success: false, error: 'X page error' };
    }
    
    // フォロワー数を取得
    let followers = 0;
    try {
      // 方法1: フォロワーリンクから取得
      const followersLink = await page.$('a[href$="/verified_followers"], a[href$="/followers"]');
      if (followersLink) {
        const text = await followersLink.textContent();
        followers = parseNumber(text);
        logger.info(`Found followers from link: ${followers}`);
      }
      
      // 方法2: ページ内テキストから取得
      if (followers === 0) {
        const match = pageContent.match(/(\d[\d,.]*[KMkm]?)\s*(Followers|フォロワー)/i);
        if (match) {
          followers = parseNumber(match[1]);
          logger.info(`Found followers from text: ${followers}`);
        }
      }
    } catch (e) {
      logger.warn(`Failed to get followers: ${e}`);
    }
    
    // 総ポスト数を取得
    let totalPosts = 0;
    try {
      // ヘッダーまたはナビゲーション部分から取得
      const match = pageContent.match(/(\d[\d,.]*[KMkm]?)\s*(posts?|ポスト)/i);
      if (match) {
        totalPosts = parseNumber(match[1]);
        logger.info(`Found posts: ${totalPosts}`);
      }
    } catch (e) {
      logger.warn(`Failed to get posts: ${e}`);
    }
    
    logger.info(`X final result: followers=${followers}, posts=${totalPosts}`);
    
    return {
      success: true,
      data: { followers, totalPosts },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`X scrape failed: ${url}`, { error: errorMessage });
    
    return {
      success: false,
      error: errorMessage,
    };
  }
};
