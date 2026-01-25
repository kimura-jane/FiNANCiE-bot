// src/scrapers/x.ts

import { XScrapeResult, XSyndicationResponse } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * X IDからユーザー名を抽出
 * "@username" や "https://x.com/username" から "username" を取り出す
 */
const extractUsername = (idOrUrl: string): string => {
  let username = idOrUrl.trim();
  
  // URLの場合
  if (username.includes('x.com/') || username.includes('twitter.com/')) {
    const match = username.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
    if (match) {
      username = match[1];
    }
  }
  
  // @を除去
  username = username.replace(/^@/, '');
  
  return username;
};

/**
 * Syndication APIを使用してXデータを取得（X版A案）
 * URL: https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=username
 */
export const scrapeX = async (
  xId: string
): Promise<XScrapeResult> => {
  const username = extractUsername(xId);
  
  if (!username) {
    return {
      success: false,
      error: 'Invalid X ID or URL',
    };
  }

  try {
    logger.info(`Scraping X via Syndication API: ${username}`);
    
    // レート制限対策で待機
    await randomDelay(2, 4);
    
    const url = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${username}`;
    
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://platform.twitter.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    logger.info(`  HTTP Status: ${response.status}`);

    if (response.status === 403) {
      logger.warn(`  403 Forbidden - IP may be blocked`);
      return { success: false, error: '403 Forbidden' };
    }
    
    if (response.status === 429) {
      logger.warn(`  429 Too Many Requests - Rate limited`);
      return { success: false, error: '429 Rate Limited' };
    }
    
    if (response.status === 404) {
      logger.warn(`  404 Not Found - User may not exist`);
      return { success: false, error: '404 Not Found' };
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data: XSyndicationResponse[] = await response.json();
    
    if (!data || data.length === 0) {
      logger.warn(`  Empty response for ${username}`);
      return { success: false, error: 'Empty response' };
    }

    const userData = data[0];
    logger.info(`  Followers: ${userData.followers_count}, Posts: ${userData.statuses_count}`);

    return {
      success: true,
      data: {
        followers: userData.followers_count || 0,
        totalPosts: userData.statuses_count || 0,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`X Syndication API failed: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
};
