/**
 * 待機・遅延ユーティリティ
 */

/**
 * 指定ミリ秒待機
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * ランダムな待機時間（min〜max秒）
 */
export const randomDelay = async (minSec: number = 5, maxSec: number = 10): Promise<void> => {
  const delayMs = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
  await sleep(delayMs);
};

/**
 * User-Agentをランダムに選択
 */
export const getRandomUserAgent = (userAgents: readonly string[]): string => {
  const index = Math.floor(Math.random() * userAgents.length);
  return userAgents[index];
};
