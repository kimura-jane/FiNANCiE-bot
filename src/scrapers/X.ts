import axios from 'axios';
import { XMetrics } from '../types';
import { logger } from '../utils/logger';

/**
 * X API v2 一括取得用スクレイパー
 */
export async function fetchXMetricsBatch(
  usernames: string[],
  bearerToken: string
): Promise<Map<string, XMetrics>> {
  const metricsMap = new Map<string, XMetrics>();
  if (usernames.length === 0) return metricsMap;

  // @を除去してカンマ区切りにする
  const cleanUsernames = usernames.map(u => u.replace(/[@＠]/g, '').trim()).join(',');
  const url = `https://api.twitter.com/2/users/by?usernames=${encodeURIComponent(cleanUsernames)}&user.fields=public_metrics`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${bearerToken}` }
    });

    const data = response.data.data;
    const now = new Date().toISOString();

    if (data && Array.isArray(data)) {
      data.forEach((user: any) => {
        metricsMap.set(user.username.toLowerCase(), {
          followers: user.public_metrics.followers_count,
          totalPosts: user.public_metrics.tweet_count,
          updatedAt: now
        });
      });
      logger.info(`[X] ${data.length}名分の一括取得に成功しました。`);
    }
    return metricsMap;
  } catch (error: any) {
    logger.error(`[X] APIエラー: ${error.message}`);
    return metricsMap;
  }
}
