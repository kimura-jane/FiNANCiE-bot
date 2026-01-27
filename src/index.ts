// src/index.ts

import { launchBrowser, createContext, createPage, closeBrowser } from './utils/browser';
import { scrapeFinancie } from './scrapers/financie';
import { SheetsClient } from './sheets/client';
import { randomDelay } from './utils/delay';
import { logger } from './utils/logger';
import { DailyMetrics, ScoredMetrics, FinancieMetrics, XMetrics } from './types';

/**
 * スコア計算（FiNANCiEのみ）
 * Score = (週間投稿数 × 30) + (Δサポーター × 10)
 */
const calculateScore = (
  current: DailyMetrics,
  yesterday: DailyMetrics | undefined
): ScoredMetrics => {
  const deltaSupporters = yesterday
    ? Math.max(0, current.financie.supporters - yesterday.financie.supporters)
    : 0;

  const score = 
    (current.financie.weeklyPosts * 30) +
    (deltaSupporters * 10);

  return {
    ...current,
    delta: {
      supporters: deltaSupporters,
      weeklyPosts: current.financie.weeklyPosts,
    },
    score: Math.round(score * 100) / 100,
  };
};

async function main(): Promise<void> {
  logger.info('=== FiNANCiE Owner Ranking System Started ===');
  
  const sheets = new SheetsClient();
  let browser = null;

  try {
    const owners = await sheets.getOwners();
    if (owners.length === 0) {
      throw new Error('No owners found in spreadsheet');
    }
    logger.info(`Found ${owners.length} owners to process`);

    const yesterdayMetrics = await sheets.getYesterdayMetrics();
    logger.info(`Yesterday metrics loaded for ${yesterdayMetrics.size} owners`);

    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await createPage(context);

    const todayDate = sheets.getTodayDate();
    const todayMetrics: DailyMetrics[] = [];

    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      logger.info(`\n[${i + 1}/${owners.length}] Processing: ${owner.name}`);
      
      const yesterday = yesterdayMetrics.get(owner.name);
      
      // FiNANCiEからデータ取得
      let financieData: FinancieMetrics = { 
        supporters: 0, 
        weeklyPosts: 0,
        lastPostTime: null 
      };
      
      if (owner.financieUrl) {
        const result = await scrapeFinancie(page, owner.financieUrl);
        
        if (result.success && result.data) {
          financieData = {
            supporters: result.data.supporters > 0 
              ? result.data.supporters 
              : (yesterday?.financie.supporters || 0),
            weeklyPosts: result.data.weeklyPosts,
            lastPostTime: result.data.lastPostTime,
          };
        } else if (yesterday) {
          financieData = yesterday.financie;
          logger.warn(`Using yesterday's data for ${owner.name}`);
        }
      }

      // Xは手動入力なので、前日データを継承
      let xData: XMetrics = { followers: 0, totalPosts: 0 };
      if (yesterday) {
        xData = yesterday.x;
      }

      todayMetrics.push({
        date: todayDate,
        name: owner.name,
        financie: financieData,
        x: xData,
      });

      logger.info(`  Result: supporters=${financieData.supporters}, weeklyPosts=${financieData.weeklyPosts}, lastPost=${financieData.lastPostTime}`);

      await randomDelay(3, 6);
    }

    await context.close();
    await closeBrowser();
    browser = null;

    const scoredMetrics: ScoredMetrics[] = todayMetrics.map(m => 
      calculateScore(m, yesterdayMetrics.get(m.name))
    );

    await sheets.appendHistory(todayMetrics);
    await sheets.updateRanking(scoredMetrics);

    logger.info('\n=== Results Summary ===');
    const sorted = [...scoredMetrics].sort((a, b) => b.score - a.score);
    sorted.slice(0, 10).forEach((m, i) => {
      logger.info(`${i + 1}. ${m.name}: ${m.score} pts (weekly=${m.financie.weeklyPosts}, supporters=${m.financie.supporters})`);
    });

    logger.info('\n=== Process Completed ===');
    
  } catch (error) {
    logger.error('Fatal error', { error: error instanceof Error ? error.message : error });
    process.exit(1);
  } finally {
    if (browser) {
      await closeBrowser();
    }
  }
}

main();
