import { XMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

/**
 * XプロフィールからユーザーIDを抽出
 */
const extractUsername = (idOrUrl: string): string => {
  // URLの場合は末尾のユーザー名を抽出
  if (idOrUrl.startsWith('http')) {
    const match = idOrUrl.match(/(?:twitter\.com|x\.com)\/(@?[\w]+)/);
    if (match) {
      return match[1].replace(/^@/, '');
    }
  }
  // @を除去して返す
  return idOrUrl.replace(/^@/, '');
};

/**
 * Syndication APIを使ってXのフォロワー数・投稿数を取得
 */
export const scrapeX = async (
  _page: unknown, // 未使用だが互換性のため残す
  idOrUrl: string
): Promise<ScrapeResult<XMetrics>> => {
  const username = extractUsername(idOrUrl);
  
  if (!username) {
    logger.error('Invalid X username/URL');
    return { success: false, error: 'Invalid username' };
  }
  
  const apiUrl = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${username}`;
  
  try {
    logger.info(`Fetching X data for: @${username}`);
    
    // リクエスト前に少し待機
    await randomDelay(2, 4);
    
    const response = await fetch(apiUrl, {
      headers: {
        'Referer': 'https://platform.twitter.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    
    // HTTPステータスをチェック
    if (!response.ok) {
      const status = response.status;
      logger.warn(`X API returned status ${status} for @${username}`);
      
      if (status === 403) {
        logger.error('X API returned 403 Forbidden');
        return { success: false, error: '403 Forbidden' };
      }
      if (status === 429) {
        logger.error('X API rate limited (429)');
        return { success: false, error: '429 Rate Limited' };
      }
      if (status === 404) {
        logger.warn(`User @${username} not found`);
        return { success: false, error: '404 User Not Found' };
      }
      
      return { success: false, error: `HTTP ${status}` };
    }
    
    const data = await response.json();
    
    // レスポンスは配列形式
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn(`Empty response for @${username}`);
      return { success: false, error: 'Empty response' };
    }
    
    const userData = data[0];
    
    const followers = userData.followers_count || 0;
    const totalPosts = userData.statuses_count || 0;
    
    logger.info(`X result for @${username}: followers=${followers}, posts=${totalPosts}`);
    
    return {
      success: true,
      data: { followers, totalPosts },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`X fetch failed for @${username}`, { error: errorMessage });
    
    return {
      success: false,
      error: errorMessage,
    };
  }
};
