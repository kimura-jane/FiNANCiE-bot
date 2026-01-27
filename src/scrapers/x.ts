// src/scrapers/x.ts

import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * Nitterミラーリスト（生存確認済み）
 */
const NITTER_MIRRORS = [
  'https://nitter.pufe.org',
  'https://nitter.cz',
  'https://nitter.poast.org',
  'https://nitter.projectsegfau.lt',
];

/**
 * X IDからユーザー名を抽出
 */
const extractUsername = (idOrUrl: string): string => {
  let username = idOrUrl.trim();
  
  if (username.includes('x.com/') || username.includes('twitter.com/')) {
    const match = username.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
    if (match) {
      username = match[1];
    }
  }
  
  username = username.replace(/^@/, '');
  
  return username;
};

/**
 * 数値文字列をパース（カンマ、K、M対応）
 */
const parseNumber = (text: string): number => {
  if (!text) return 0;
  
  const cleaned = text.trim().replace(/,/g, '');
  
  // K（千）対応
  if (cleaned.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000);
  }
  
  // M（百万）対応
  if (cleaned.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000000);
  }
  
  return parseInt(cleaned, 10) || 0;
};

/**
 * Nitterからプロフィールデータを取得
 */
const fetchFromNitter = async (
  username: string,
  mirror: string
): Promise<{ tweets: number; followers: number } | null> => {
  try {
    const url = `${mirror}/${username}`;
    logger.info(`  Trying: ${url}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn(`  ${mirror}: HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // プロフィール統計を抽出（Nitterの構造）
    // <span class="profile-stat-num">1,234</span>
    const statMatches = html.match(/<span class="profile-stat-num"[^>]*>([^<]+)<\/span>/g);
    
    if (!statMatches || statMatches.length < 3) {
      logger.warn(`  ${mirror}: Could not find stats`);
      return null;
    }
    
    // 順序: Tweets, Following, Followers, Likes
    const tweets = parseNumber(statMatches[0].replace(/<[^>]+>/g, ''));
    const followers = parseNumber(statMatches[2].replace(/<[^>]+>/g, ''));
    
    logger.info(`  ${mirror}: tweets=${tweets}, followers=${followers}`);
    
    return { tweets, followers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`  ${mirror}: ${message}`);
    return null;
  }
};

/**
 * Nitterを使用してXデータを取得（フォールバック付き）
 */
export const scrapeX = async (
  xId: string
): Promise<ScrapeResult<XMetrics>> => {
  const username = extractUsername(xId);
  
  if (!username) {
    return {
      success: false,
      error: 'Invalid X ID or URL',
    };
  }

  logger.info(`Scraping X via Nitter: ${username}`);
  
  // 各ミラーを順番に試す
  for (const mirror of NITTER_MIRRORS) {
    // レート制限対策
    await randomDelay(2, 4);
    
    const result = await fetchFromNitter(username, mirror);
    
    if (result) {
      return {
        success: true,
        data: {
          followers: result.followers,
          totalPosts: result.tweets,
        },
      };
    }
  }
  
  // 全ミラー失敗
  logger.error(`All Nitter mirrors failed for ${username}`);
  return {
    success: false,
    error: 'All Nitter mirrors failed',
  };
};
