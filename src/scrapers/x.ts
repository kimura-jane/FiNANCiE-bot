// src/scrapers/x.ts

import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * Nitterミラーリスト
 */
const NITTER_MIRRORS = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
 * タグと特殊スペースを除去
 */
const strip = (s: string): string => {
  return s
    .replace(/<[^>]+>/g, '')      // HTMLタグ除去
    .replace(/\u202F/g, '')       // ナロー・ノーブレークスペース除去
    .replace(/\u00A0/g, '')       // ノーブレークスペース除去
    .replace(/,/g, '')            // カンマ除去
    .replace(/\s+/g, '')          // 通常スペース除去
    .trim();
};

/**
 * 数値をパース（K、M対応）
 */
const parseNumber = (text: string): number => {
  const cleaned = strip(text).toLowerCase();
  
  if (cleaned.endsWith('k')) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000);
  }
  if (cleaned.endsWith('m')) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000000);
  }
  
  return parseInt(cleaned, 10) || 0;
};

/**
 * Syndication APIから取得（先に試す）
 */
const fetchFromSyndication = async (
  username: string
): Promise<{ tweets: number; followers: number } | null> => {
  try {
    const url = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${username}`;
    logger.info(`  Trying Syndication API: ${username}`);
    
    const response = await fetch(url, {
      headers: { 
        'User-Agent': UA,
        'Referer': 'https://platform.twitter.com/',
      },
    });
    
    if (!response.ok) {
      logger.warn(`  Syndication: HTTP ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    if (!text || text.length === 0) {
      logger.warn(`  Syndication: Empty response`);
      return null;
    }
    
    const data = JSON.parse(text);
    if (!data || data.length === 0) {
      logger.warn(`  Syndication: Empty array`);
      return null;
    }
    
    const result = {
      tweets: data[0].statuses_count || 0,
      followers: data[0].followers_count || 0,
    };
    
    logger.info(`  Syndication OK: tweets=${result.tweets}, followers=${result.followers}`);
    return result;
  } catch (error) {
    logger.warn(`  Syndication failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
};

/**
 * Nitterから取得（フォールバック）
 */
const fetchFromNitter = async (
  username: string,
  mirror: string
): Promise<{ tweets: number; followers: number } | null> => {
  try {
    const url = `${mirror}/${username}`;
    logger.info(`  Trying Nitter: ${url}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn(`  Nitter ${mirror}: HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // ラベル付きで統計を取得
    const stats: Record<string, number> = {};
    
    // <li class="posts"><span class="profile-stat-num">...</span>...</li>
    const liPattern = /<li class="([^"]+)"[^>]*>[\s\S]*?<span class="profile-stat-num"[^>]*>([\s\S]*?)<\/span>/gi;
    let match;
    
    while ((match = liPattern.exec(html)) !== null) {
      const label = match[1].toLowerCase();
      const numText = strip(match[2]);
      const num = parseNumber(numText);
      stats[label] = num;
      logger.info(`    Found: ${label} = ${num}`);
    }
    
    // 代替パターン: profile-stat-num だけを順番に取得
    if (Object.keys(stats).length === 0) {
      const numPattern = /<span class="profile-stat-num"[^>]*>([\s\S]*?)<\/span>/gi;
      const numbers: number[] = [];
      
      while ((match = numPattern.exec(html)) !== null) {
        const num = parseNumber(strip(match[1]));
        numbers.push(num);
      }
      
      if (numbers.length >= 3) {
        // 通常: [tweets, following, followers, likes]
        stats['tweets'] = numbers[0];
        stats['followers'] = numbers[2];
        logger.info(`    Fallback parse: tweets=${numbers[0]}, followers=${numbers[2]}`);
      }
    }
    
    const tweets = stats['posts'] || stats['tweets'] || 0;
    const followers = stats['followers'] || 0;
    
    if (tweets === 0 && followers === 0) {
      logger.warn(`  Nitter ${mirror}: Could not parse stats`);
      return null;
    }
    
    logger.info(`  Nitter OK: tweets=${tweets}, followers=${followers}`);
    return { tweets, followers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`  Nitter ${mirror}: ${message}`);
    return null;
  }
};

/**
 * Xデータを取得（Syndication → Nitter の順）
 */
export const scrapeX = async (
  xId: string
): Promise<ScrapeResult<XMetrics>> => {
  const username = extractUsername(xId);
  
  if (!username) {
    return { success: false, error: 'Invalid X ID' };
  }
  
  logger.info(`Scraping X: ${username}`);
  
  // ① Syndication API を先に試す
  const viaSynd = await fetchFromSyndication(username);
  if (viaSynd) {
    return {
      success: true,
      data: {
        followers: viaSynd.followers,
        totalPosts: viaSynd.tweets,
      },
    };
  }
  
  // ② Nitter を試す
  for (const mirror of NITTER_MIRRORS) {
    await randomDelay(1, 3);
    const viaNitter = await fetchFromNitter(username, mirror);
    if (viaNitter) {
      return {
        success: true,
        data: {
          followers: viaNitter.followers,
          totalPosts: viaNitter.tweets,
        },
      };
    }
  }
  
  // 全部失敗
  logger.error(`All sources failed for ${username}`);
  return { success: false, error: 'All sources failed' };
};
