import { logger } from '../utils/logger';
import { XMetrics, ScrapeResult } from '../types';

const NITTER_MIRRORS = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractUsername(xId: string | null): string | null {
  if (!xId) return null;
  
  let username = xId.trim();
  
  // URL形式の場合
  if (username.includes('x.com/') || username.includes('twitter.com/')) {
    const match = username.match(/(?:x\.com|twitter\.com)\/([^\/\?]+)/);
    if (match) username = match[1];
  }
  
  // @を除去
  username = username.replace(/^@/, '');
  
  return username || null;
}

function parseNumber(text: string): number {
  if (!text) return 0;
  
  const cleaned = text.replace(/,/g, '').trim();
  
  // K/M表記対応
  if (cleaned.toLowerCase().includes('k')) {
    return Math.round(parseFloat(cleaned) * 1000);
  }
  if (cleaned.toLowerCase().includes('m')) {
    return Math.round(parseFloat(cleaned) * 1000000);
  }
  
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// Syndication API経由で取得
async function fetchFromSyndication(username: string): Promise<{ followers: number; tweets: number } | null> {
  try {
    const url = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${username}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://platform.twitter.com/',
        'Origin': 'https://platform.twitter.com'
      }
    });
    
    logger.info(`[X] Syndication API for @${username}: HTTP ${response.status}`);
    
    if (!response.ok) {
      return null;
    }
    
    const text = await response.text();
    logger.info(`[X] Response length: ${text.length} chars`);
    
    if (!text || text.length < 10) {
      logger.warn(`[X] Empty response for @${username}`);
      return null;
    }
    
    const data = JSON.parse(text);
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    const user = data[0];
    const followers = user.followers_count || 0;
    const tweets = user.statuses_count || 0;
    
    logger.info(`[X] Syndication success: @${username} - followers=${followers}, tweets=${tweets}`);
    
    return { followers, tweets };
    
  } catch (error) {
    logger.warn(`[X] Syndication failed for @${username}: ${error}`);
    return null;
  }
}

// Nitter経由で取得
async function fetchFromNitter(username: string, mirror: string): Promise<{ followers: number; tweets: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const url = `${mirror}/${username}`;
    logger.info(`[X] Trying Nitter: ${url}`);
    
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
      redirect: 'follow'
    });
    
    if (!response.ok) {
      logger.warn(`[X] Nitter ${mirror}: HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // 統計を抽出（複数パターン対応）
    const stats: { [key: string]: number } = {};
    
    // パターン1: profile-stat-num クラス
    const statPattern = /<span class="profile-stat-(?:num|value)"[^>]*>([^<]+)<\/span>\s*<span class="profile-stat-header"[^>]*>([^<]+)<\/span>/gi;
    let match;
    while ((match = statPattern.exec(html)) !== null) {
      const value = match[1].replace(/[\u202F\u00A0\s,]/g, '');
      const label = match[2].toLowerCase();
      stats[label] = parseNumber(value);
    }
    
    // パターン2: 逆順（ヘッダーが先）
    const statPattern2 = /<span class="profile-stat-header"[^>]*>([^<]+)<\/span>\s*<span class="profile-stat-(?:num|value)"[^>]*>([^<]+)<\/span>/gi;
    while ((match = statPattern2.exec(html)) !== null) {
      const label = match[1].toLowerCase();
      const value = match[2].replace(/[\u202F\u00A0\s,]/g, '');
      stats[label] = parseNumber(value);
    }
    
    const tweets = stats['tweets'] || stats['posts'] || stats['notes'] || 0;
    const followers = stats['followers'] || stats['follower'] || 0;
    
    if (followers === 0 && tweets === 0) {
      logger.warn(`[X] Nitter ${mirror}: Could not parse stats`);
      return null;
    }
    
    logger.info(`[X] Nitter success: @${username} - followers=${followers}, tweets=${tweets}`);
    return { followers, tweets };
    
  } catch (error) {
    logger.warn(`[X] Nitter ${mirror} failed: ${error}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeX(xId: string | null): Promise<ScrapeResult<XMetrics>> {
  const username = extractUsername(xId);
  
  if (!username) {
    return { success: false, error: 'Invalid X ID' };
  }
  
  logger.info(`[X] Scraping @${username}`);
  
  // 1. まずSyndication APIを試す
  const syndicationResult = await fetchFromSyndication(username);
  if (syndicationResult) {
    return {
      success: true,
      data: {
        followers: syndicationResult.followers,
        totalPosts: syndicationResult.tweets
      }
    };
  }
  
  // 2. Nitterミラーを順番に試す
  for (const mirror of NITTER_MIRRORS) {
    // レート制限対策で少し待機
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const nitterResult = await fetchFromNitter(username, mirror);
    if (nitterResult) {
      return {
        success: true,
        data: {
          followers: nitterResult.followers,
          totalPosts: nitterResult.tweets
        }
      };
    }
  }
  
  logger.error(`[X] All sources failed for @${username}`);
  return { success: false, error: 'All sources failed' };
}
