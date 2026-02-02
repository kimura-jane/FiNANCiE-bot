// src/scrapers/X.ts

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
  
  const url = `https://api.twitter.com/2/users/by?usernames=${cleanUsernames}&user.fields=public_metrics`;

  // デバッグ用ログ
  logger.info(`[X] リクエストURL: ${url}`);
  logger.info(`[X] ユーザー数: ${usernames.length}, Bearer Token存在: ${!!bearerToken}, Token長: ${bearerToken?.length || 0}`);

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
    if (error.response) {
      logger.error(`[X] ステータス: ${error.response.status}`);
      logger.error(`[X] レスポンス: ${JSON.stringify(error.response.data)}`);
    }
    return metricsMap;
  }
}
