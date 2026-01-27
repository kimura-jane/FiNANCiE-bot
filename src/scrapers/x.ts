// src/scrapers/x.ts

import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

const NITTER_MIRRORS = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

const strip = (s: string): string => {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\u202F/g, '')
    .replace(/\u00A0/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
};

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
        'Origin': 'https://platform.twitter.com',
      },
    });
    
    logger.info(`  Syndication HTTP: ${response.status}`);
    
    if (!response.ok) {
      logger.warn(`  Syndication: HTTP ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    logger.info(`  Syndication response length: ${text.length}`);
    
    if (!text || text.length === 0) {
      logger.warn(`  Syndication: Empty response`);
      return null;
    }
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.warn(`  Syndication: JSON parse failed`);
      return null;
    }
    
    if (!data || data.length === 0) {
      logger.warn(`  Syndication: Empty array`);
      return null;
    }
    
    const result = {
      tweets: data[0].statuses_count ?? data[0].tweet_count ?? 0,
      followers: data[0].followers_count ?? 0,
    };
    
    logger.info(`  Syndication OK: tweets=${result.tweets}, followers=${result.followers}`);
    return result;
  } catch (error) {
    logger.warn(`  Syndication failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
};

const fetchFromNitter = async (
  username: string,
  mirror: string
): Promise<{ tweets: number; followers: number } | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  
  try {
    const url = `${mirror}/${username}`;
    logger.info(`  Trying Nitter: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    if (!response.ok) {
      logger.warn(`  Nitter ${mirror}: HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    const stats: Record<string, number> = {};
    
    // 修正: profile-stat-num と profile-stat-value 両対応
    const liPattern = /<li class="([^"]+)"[^>]*>[\s\S]*?<span class="profile-stat-(?:num|value)"[^>]*>([\s\S]*?)<\/span>/gi;
    let match;
    
    while ((match = liPattern.exec(html)) !== null) {
      const label = match[1].toLowerCase();
      const numText = strip(match[2]);
      const num = parseNumber(numText);
      stats[label] = num;
      logger.info(`    Found: ${label} = ${num}`);
    }
    
    if (Object.keys(stats).length === 0) {
      // 修正: profile-stat-num と profile-stat-value 両対応
      const numPattern = /<span class="profile-stat-(?:num|value)"[^>]*>([\s\S]*?)<\/span>/gi;
      const numbers: number[] = [];
      
      while ((match = numPattern.exec(html)) !== null) {
        const num = parseNumber(strip(match[1]));
        numbers.push(num);
      }
      
      if (numbers.length >= 3) {
        stats['tweets'] = numbers[0];
        stats['followers'] = numbers[2];
        logger.info(`    Fallback parse: tweets=${numbers[0]}, followers=${numbers[2]}`);
      }
    }
    
    if (Object.keys(stats).length === 0) {
      logger.warn(`  Nitter ${mirror}: Could not parse stats`);
      return null;
    }
    
    const tweets = stats['posts'] ?? stats['tweets'] ?? stats['notes'] ?? 0;
    const followers = stats['followers'] ?? 0;
    
    logger.info(`  Nitter OK: tweets=${tweets}, followers=${followers}`);
    return { tweets, followers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`  Nitter ${mirror}: ${message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

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
  
  logger.warn(`All sources failed for ${username}`);
  return { success: false, error: 'All sources failed' };
};
