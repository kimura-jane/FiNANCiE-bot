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
  
  // K（千）、M（百万）表記の処理
  if (cleaned.includes('k')) {
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return Math.round(num * 1000);
  }
  if (cleaned.includes('m')) {
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return Math.round(num * 1000000);
  }
  
  // 通常の数値
  return parseInt(cleaned.replace(/[^0-9]/g, ''), 10) || 0;
};

/**
 * XプロフィールURLを正規化
 */
const normalizeXUrl = (idOrUrl: string): string => {
  // すでにURLの場合はそのまま返す
  if (idOrUrl.startsWith('http')) {
    return idOrUrl;
  }
  // @を除去してURLを構築
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
    
    // X.comはリダイレクトが多いのでdomcontentloadedで待つ
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // ページ読み込み待機
    await page.waitForSelector(X_SELECTORS.PAGE_LOADED, { timeout: 20000 })
      .catch(() => logger.warn('X page load selector not found, continuing...'));
    
    // 追加の待機（動的コンテンツ対策）
    await randomDelay(3, 6);
    
    // ログイン要求モーダルの確認
    const loginModal = await page.$(X_SELECTORS.LOGIN_MODAL);
    if (loginModal) {
      logger.warn('Login modal detected, data may be limited');
    }
    
    // フォロワー数を取得
    let followers = 0;
    try {
      // href属性で探す（より確実）
      const followersLink = await page.$('a[href$="/verified_followers"], a[href$="/followers"]');
      if (followersLink) {
        const text = await followersLink.textContent();
        followers = parseNumber(text);
      } else {
        // フォールバック: aria-label含むテキストを探す
        const pageContent = await page.content();
        const match = pageContent.match(/(\d[\d,.]*[KMkm]?)\s*(Followers|フォロワー)/);
        if (match) {
          followers = parseNumber(match[1]);
        }
      }
    } catch (e) {
      logger.warn('Failed to get followers count');
    }
    
    // 総ポスト数を取得（プロフィールヘッダーから）
    let totalPosts = 0;
    try {
      // ヘッダー部分のポスト数を探す
      const headerText = await page.textContent('[data-testid="primaryColumn"] header, [data-testid="UserProfileHeader_Items"]');
      if (headerText) {
        const match = headerText.match(/(\d[\d,.]*[KMkm]?)\s*(posts?|ポスト)/i);
        if (match) {
          totalPosts = parseNumber(match[1]);
        }
      }
      
      // フォールバック
      if (totalPosts === 0) {
        const pageContent = await page.content();
        const match = pageContent.match(/(\d[\d,.]*[KMkm]?)\s*(posts?|ポスト)/i);
        if (match) {
          totalPosts = parseNumber(match[1]);
        }
      }
    } catch (e) {
      logger.warn('Failed to get total posts count');
    }
    
    logger.info(`X result: followers=${followers}, posts=${totalPosts}`);
    
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
