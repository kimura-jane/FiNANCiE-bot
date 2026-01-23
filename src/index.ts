import { launchBrowser, createContext, createPage, closeBrowser } from './utils/browser';
import { scrapeFinancie } from './scrapers/financie';
import { scrapeX } from './scrapers/x';
import { SheetsClient } from './sheets/client';
import { randomDelay } from './utils/delay';
import { logger } from './utils/logger';
import { DailyMetrics, ScoredMetrics, FinancieMetrics, XMetrics } from './types';

/**
 * スコア計算
 * Score = (ΔF × 50) + (ΔXp × 20) + (ΔM × 10) + (ΔL × 0.1)
 */
const calculateScore = (
  current: DailyMetrics,
  yesterday: DailyMetrics | undefined
): ScoredMetrics => {
  const deltaFinanciePosts = yesterday 
    ? Math.max(0, current.financie.totalPosts - yesterday.financie.totalPosts)
    : 0;
  const deltaXPosts = yesterday
    ? Math.max(0, current.x.totalPosts - yesterday.x.totalPosts)
    : 0;
  const deltaSupporters = yesterday
    ? Math.max(0, current.financie.supporters - yesterday.financie.supporters)
    : 0;
  const deltaFollowers = yesterday
    ? Math.max(0, current.x.followers - yesterday.x.followers)
    : 0;

  const score = 
    (deltaFinanciePosts * 50) +
    (deltaXPosts * 20) +
    (deltaSupporters * 10) +
    (deltaFollowers * 0.1);

  return {
    ...current,
    delta: {
      financiePosts: deltaFinanciePosts,
      xPosts: deltaXPosts,
      supporters: deltaSupporters,
      followers: deltaFollowers,
    },
    score: Math.round(score * 100) / 100,
  };
};

/**
 * メイン処理
 */
async function main(): Promise<void> {
  logger.info('=== FiNANCiE Owner Ranking System Started ===');
  
  const sheets = new SheetsClient();
  let browser = null;

  try {
    // 1. オーナー一覧を取得
    const owners = await sheets.getOwners();
    if (owners.length === 0) {
      throw new Error('No owners found in spreadsheet');
    }

    // 2. 昨日のデータを取得
    const yesterdayMetrics = await sheets.getYesterdayMetrics();

    // 3. ブラウザを起動
    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await createPage(context);

    // 4. 各オーナーのデータを収集
    const todayDate = sheets.getTodayDate();
    const todayMetrics: DailyMetrics[] = [];

    for (const owner of owners) {
      logger.info(`Processing: ${owner.name}`);
      
      // 前日データ（フォールバック用）
      const yesterday = yesterdayMetrics.get(owner.name);
      
      // FiNANCiEからデータ取得
      let financieData: FinancieMetrics = { supporters: 0, totalPosts: 0 };
      if (owner.financieUrl) {
        const result = await scrapeFinancie(page, owner.financieUrl);
        if (result.success && result.data) {
          financieData = result.data;
        } else if (yesterday) {
          // 失敗時は前日データを継承
          financieData = yesterday.financie;
          logger.warn(`Using yesterday's FiNANCiE data for ${owner.name}`);
        }
      }

      // 待機
      await randomDelay(5, 10);

      // Xからデータ取得
      let xData: XMetrics = { followers: 0, totalPosts: 0 };
      if (owner.xId) {
        const result = await scrapeX(page, owner.xId);
        if (result.success && result.data) {
          xData = result.data;
        } else if (yesterday) {
          // 失敗時は前日データを継承
          xData = yesterday.x;
          logger.warn(`Using yesterday's X data for ${owner.name}`);
        }
      }

      todayMetrics.push({
        date: todayDate,
        name: owner.name,
        financie: financieData,
        x: xData,
      });

      // 次のオーナーの前に待機
      await randomDelay(5, 10);
    }

    // 5. コンテキストを閉じる
    await context.close();

    // 6. スコアを計算
    const scoredMetrics: ScoredMetrics[] = todayMetrics.map(m => 
      calculateScore(m, yesterdayMetrics.get(m.name))
    );

    // 7. スプレッドシートに保存
    await sheets.appendHistory(todayMetrics);
    await sheets.updateRanking(scoredMetrics);

    // 8. 結果サマリーを出力
    logger.info('=== Results Summary ===');
    const sorted = [...scoredMetrics].sort((a, b) => b.score - a.score);
    sorted.slice(0, 5).forEach((m, i) => {
      logger.info(`${i + 1}. ${m.name}: ${m.score} points`);
    });

    logger.info('=== Process Completed Successfully ===');
  } catch (error) {
    logger.error('Fatal error', { error: error instanceof Error ? error.message : error });
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

// 実行
main();
