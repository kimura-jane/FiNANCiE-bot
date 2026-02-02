import axios from 'axios';
import { XMetrics } from '../types';
import { logger } from '../utils/logger';

/**
 * X API v2 (Pay-per-use) を使用して一括取得する
 * コスト: 1リクエストにつき $0.005 (約0.75円) 固定
 */
export async function fetchXMetricsBatch(
  usernames: string[],
  bearerToken: string
): Promise<Map<string, XMetrics>> {
  const metricsMap = new Map<string, XMetrics>();
  
  if (!usernames || usernames.length === 0) {
    logger.warn('[X] 有効なX IDが見つかりません。取得をスキップします。');
    return metricsMap;
  }

  // IDから@を除去してカンマ区切りにする (最大100件まで1リクエストでOK)
  const cleanUsernames = usernames
    .map(u => u.replace(/[@＠]/g, '').trim())
    .filter(u => u !== "")
    .join(',');

  const url = `https://api.twitter.com/2/users/by?usernames=${encodeURIComponent(cleanUsernames)}&user.fields=public_metrics`;

  try {
    logger.info(`[X] ${usernames.length}名分のデータを一括取得中...`);
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${bearerToken}` }
    });

    const now = new Date().toISOString();
    const data = response.data.data;

    if (data && Array.isArray(data)) {
      data.forEach((user: any) => {
        metricsMap.set(user.username.toLowerCase(), {
          followers: user.public_metrics.followers_count,
          totalPosts: user.public_metrics.tweet_count,
          updatedAt: now
        });
      });
      logger.info(`[X] 取得成功。消費クレジット: $0.005`);
    } else {
      logger.warn('[X] ユーザーデータが返されませんでした。APIの残高か設定を確認してください。');
    }

    return metricsMap;
  } catch (error: any) {
    logger.error(`[X] APIエラー: ${error.response?.data?.title || error.message}`);
    return metricsMap;
  }
}
