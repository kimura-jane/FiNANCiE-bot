// src/index.ts

import { launchBrowser, createContext, createPage, closeBrowser } from './utils/browser';
import { scrapeFinancie } from './scrapers/financie';
import { scrapeX } from './scrapers/x';
import { SheetsClient } from './sheets/client';
import { randomDelay } from './utils/delay';
import { logger } from './utils/logger';
import { DailyMetrics, ScoredMetrics, FinancieMetrics, XMetrics } from './types';

/**
 * スコア計算（A案: アクティブ判定ベース）
 * 
 * 新スコア式:
 * - FiNANCiE 24時間以内投稿あり: +50点
 * - ΔXp (X投稿数の増加): × 20点
 * - ΔM (サポーター数の増加): × 10点
 * - ΔL (フォロワー数の増加): × 0.1点
 */
const calculateScore = (
  current: DailyMetrics,
  yesterday: DailyMetrics | undefined
): ScoredMetrics => {
  // FiNANCiEはアクティブ判定（24時間以内に投稿があれば+50）
  const financieActiveBonus = current.financie.isActive ? 50 : 0;
  
  // X投稿数の差分
  const deltaXPosts = yesterday
    ? Math.max(0, current.x.totalPosts - yesterday.x.totalPosts)
    : 0;
  
  // サポーター数の差分
  const deltaSupporters = yesterday
    ? Math.max(0, current.financie.supporters - yesterday.financie.supporters)
    : 0;
  
  // フォロワー数の差分
  const deltaFollowers = yesterday
    ? Math.max(0, current.x.followers - yesterday.x.followers)
    : 0;

  const score = 
    financieActiveBonus +
    (deltaXPosts * 20) +
    (deltaSupporters * 10) +
    (deltaFollowers * 0.1);

  return {
    ...current,
    delta: {
      financieActive: current.financie.isActive,
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
  logger.info(`Timestamp: ${new Date().toISOString()}`);
  
  const sheets = new SheetsClient();
  let browser = null;

  try {
    // 1. オーナー一覧を取得
    logger.info('Step 1: Fetching owners from spreadsheet...');
    const owners = await sheets.getOwners();
    if (owners.length === 0) {
      throw new Error('No owners found in spreadsheet');
    }
    logger.info(`Found ${owners.length} owners to process`);

    // 2. 昨日のデータを取得
    logger.info('Step 2: Fetching yesterday metrics...');
    const yesterdayMetrics = await sheets.getYesterdayMetrics();
    logger.info(`Yesterday metrics loaded for ${yesterdayMetrics.size} owners`);

    // 3. ブラウザを起動（FiNANCiE用のみ）
    logger.info('Step 3: Launching browser for FiNANCiE scraping...');
    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await createPage(context);

    // 4. 各オーナーのデータを収集
    logger.info('Step 4: Collecting data for each owner...');
    const todayDate = sheets.getTodayDate();
    const todayMetrics: DailyMetrics[] = [];

    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      logger.info(`\n[${i + 1}/${owners.length}] Processing: ${owner.name}`);
      
      // 前日データ（フォールバック用）
      const yesterday = yesterdayMetrics.get(owner.name);
      
      // === FiNANCiE データ取得 ===
      let financieData: FinancieMetrics = { 
        supporters: 0, 
        totalPosts: 0,
        isActive: false,
        lastPostTime: null 
      };
      
      if (owner.financieUrl) {
        logger.info(`  FiNANCiE: ${owner.financieUrl}`);
        const result = await scrapeFinancie(page, owner.financieUrl);
        
        if (result.success && result.data) {
          financieData = {
            supporters: result.data.supporters > 0 
              ? result.data.supporters 
              : (yesterday?.financie.supporters || 0),
            totalPosts: result.data.totalPosts || (yesterday?.financie.totalPosts || 0),
            isActive: result.data.isActive || false,
            lastPostTime: result.data.lastPostTime || null,
          };
          logger.info(`  FiNANCiE OK: supporters=${financieData.supporters}, active=${financieData.isActive}, lastPost=${financieData.lastPostTime}`);
        } else {
          // 取得失敗時は前日データを継承
          if (yesterday) {
            financieData = {
              ...yesterday.financie,
              isActive: false, // 取得失敗時は非アクティブ扱い
            };
            logger.warn(`  FiNANCiE FAILED: Using yesterday's data for ${owner.name}`);
          } else {
            logger.warn(`  FiNANCiE FAILED: No fallback data available`);
          }
        }
      } else {
        logger.warn(`  FiNANCiE: No URL provided`);
        if (yesterday) {
          financieData = { ...yesterday.financie, isActive: false };
        }
      }

      // 待機（FiNANCiE → X の間）
      await randomDelay(3, 5);

      // === X データ取得（Syndication API使用） ===
      let xData: XMetrics = { followers: 0, totalPosts: 0 };
      
      if (owner.xId) {
        logger.info(`  X: ${owner.xId}`);
        const result = await scrapeX(owner.xId);
        
        if (result.success && result.data) {
          xData = {
            followers: result.data.followers > 0 
              ? result.data.followers 
              : (yesterday?.x.followers || 0),
            totalPosts: result.data.totalPosts > 0 
              ? result.data.totalPosts 
              : (yesterday?.x.totalPosts || 0),
          };
          logger.info(`  X OK: followers=${xData.followers}, posts=${xData.totalPosts}`);
        } else {
          // 取得失敗時は前日データを継承
          if (yesterday) {
            xData = yesterday.x;
            logger.warn(`  X FAILED: Using yesterday's data for ${owner.name} (${result.error || 'unknown error'})`);
          } else {
            logger.warn(`  X FAILED: No fallback data available (${result.error || 'unknown error'})`);
          }
        }
      } else {
        logger.warn(`  X: No ID provided`);
        if (yesterday) {
          xData = yesterday.x;
        }
      }

      // 今日のメトリクスに追加
      todayMetrics.push({
        date: todayDate,
        name: owner.name,
        financie: financieData,
        x: xData,
      });

      logger.info(`  Summary: FiNANCiE(supporters=${financieData.supporters}, active=${financieData.isActive}), X(followers=${xData.followers}, posts=${xData.totalPosts})`);

      // 次のオーナーの前に待機（レート制限対策）
      if (i < owners.length - 1) {
        await randomDelay(3, 6);
      }
    }

    // 5. ブラウザを閉じる
    logger.info('\nStep 5: Closing browser...');
    await context.close();
    await closeBrowser();
    browser = null;

    // 6. スコアを計算
    logger.info('Step 6: Calculating scores...');
    const scoredMetrics: ScoredMetrics[] = todayMetrics.map(m => 
      calculateScore(m, yesterdayMetrics.get(m.name))
    );

    // 7. スプレッドシートに保存
    logger.info('Step 7: Saving to spreadsheet...');
    await sheets.appendHistory(todayMetrics);
    await sheets.updateRanking(scoredMetrics);

    // 8. 結果サマリーを出力
    logger.info('\n=== Results Summary ===');
    const sorted = [...scoredMetrics].sort((a, b) => b.score - a.score);
    
    logger.info('Top 10 Rankings:');
    sorted.slice(0, 10).forEach((m, i) => {
      const activeIcon = m.financie.isActive ? '◎' : '×';
      logger.info(`  ${i + 1}. ${m.name}: ${m.score} pts [FiNANCiE:${activeIcon}] (ΔX:${m.delta.xPosts}, ΔM:${m.delta.supporters}, ΔL:${m.delta.followers})`);
    });

    // 統計情報
    const activeCount = scoredMetrics.filter(m => m.financie.isActive).length;
    const totalScore = scoredMetrics.reduce((sum, m) => sum + m.score, 0);
    logger.info(`\nStatistics:`);
    logger.info(`  Active owners (24h): ${activeCount}/${scoredMetrics.length}`);
    logger.info(`  Total score: ${totalScore}`);
    logger.info(`  Average score: ${(totalScore / scoredMetrics.length).toFixed(2)}`);

    logger.info('\n=== Process Completed Successfully ===');
    
  } catch (error) {
    logger.error('Fatal error occurred', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined 
    });
    process.exit(1);
  } finally {
    // ブラウザが残っていれば閉じる
    if (browser) {
      try {
        await closeBrowser();
      } catch (e) {
        logger.warn('Failed to close browser in finally block');
      }
    }
  }
}

// 実行
main();
