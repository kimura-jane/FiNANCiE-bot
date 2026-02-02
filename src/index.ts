// src/index.ts

import * as fs from 'fs';
import * as path from 'path';
import { launchBrowser, createContext, closeBrowser } from './utils/browser';
import { scrapeFinancie } from './scrapers/financie';
import { fetchXMetricsBatch } from './scrapers/X';
import { SheetsClient } from './sheets/client';
import { randomDelay } from './utils/delay';
import { logger } from './utils/logger';
import { DailyMetrics, ScoredMetrics, FinancieMetrics, XMetrics, Owner, XDailyAverage } from './types';

/**
 * スコア計算ロジック
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

/**
 * X一日平均を計算
 */
const calculateXDailyAverage = (
  xHistory: Array<{ date: string; followers: number; posts: number; updatedAt: string }>
): XDailyAverage | null => {
  if (xHistory.length < 2) {
    if (xHistory.length === 1) {
      return {
        avgFollowersPerDay: 0,
        avgPostsPerDay: 0,
        totalDays: 0,
        latestFollowers: xHistory[0].followers,
        latestPosts: xHistory[0].posts,
      };
    }
    return null;
  }

  const first = xHistory[0];
  const last = xHistory[xHistory.length - 1];
  
  const firstDate = new Date(first.updatedAt);
  const lastDate = new Date(last.updatedAt);
  const daysDiff = Math.max(1, Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));

  const followersDiff = last.followers - first.followers;
  const postsDiff = last.posts - first.posts;

  return {
    avgFollowersPerDay: Math.round((followersDiff / daysDiff) * 100) / 100,
    avgPostsPerDay: Math.round((postsDiff / daysDiff) * 100) / 100,
    totalDays: daysDiff,
    latestFollowers: last.followers,
    latestPosts: last.posts,
  };
};

/**
 * メイン処理
 */
async function main(): Promise<void> {
  logger.info('=== FiNANCiE & X Owner Ranking System Started ===');
  
  const sheets = new SheetsClient();
  let browser = null;

  try {
    const owners = await sheets.getOwners();
    if (owners.length === 0) {
      throw new Error('No owners found in spreadsheet');
    }
    logger.info(`Found ${owners.length} owners to process`);

    // 1. Xのデータを一括で取得
    const xIds = owners.map(o => o.xId).filter((id): id is string => !!id);
    const xMetricsMap = await fetchXMetricsBatch(xIds, process.env.X_BEARER_TOKEN || '');

    const yesterdayMetrics = await sheets.getYesterdayMetrics();
    logger.info(`Yesterday metrics loaded for ${yesterdayMetrics.size} owners`);

    browser = await launchBrowser();
    const context = await createContext(browser);

    const todayDate = sheets.getTodayDate();
    const todayMetrics: DailyMetrics[] = [];

    // 2. FiNANCiEのスクレイピングループ
    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      logger.info(`\n[${i + 1}/${owners.length}] Processing: ${owner.name}`);
      
      const yesterday = yesterdayMetrics.get(owner.name);
      
      let financieData: FinancieMetrics = { 
        supporters: 0, 
        weeklyPosts: 0,
        lastPostTime: null 
      };
      
      if (owner.financieUrl) {
        const page = await context.newPage();
        try {
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
        } finally {
          await page.close();
        }
      }

      // 3. 取得済みのXデータをマップから取り出す
      const xKey = owner.xId?.replace(/[@＠]/g, '').toLowerCase() || '';
      const xDataFromApi = xMetricsMap.get(xKey);

      let xData: XMetrics = { 
        followers: xDataFromApi?.followers || yesterday?.x.followers || 0, 
        totalPosts: xDataFromApi?.totalPosts || yesterday?.x.totalPosts || 0, 
        updatedAt: xDataFromApi?.updatedAt || yesterday?.x.updatedAt || todayDate 
      };

      todayMetrics.push({
        date: todayDate,
        name: owner.name,
        financie: financieData,
        x: xData,
      });

      logger.info(`  Result: supporters=${financieData.supporters}, xFollowers=${xData.followers}`);

      await randomDelay(3, 6);
    }

    await context.close();
    await closeBrowser();
    browser = null;

    const scoredMetrics: ScoredMetrics[] = todayMetrics.map(m => 
      calculateScore(m, yesterdayMetrics.get(m.name))
    );

    // 4. スプレッドシートと履歴の更新
    await sheets.appendHistory(todayMetrics);
    await sheets.updateRanking(scoredMetrics);

    const allHistory = await sheets.getAllHistory();
    const xHistory = await sheets.getXHistory();

    const sorted = [...scoredMetrics].sort((a, b) => b.financie.supporters - a.financie.supporters);

    // 履歴データを整形
    const historyData: { [key: string]: Array<{ date: string; supporters: number }> } = {};
    for (const [name, history] of allHistory) {
      historyData[name] = history.map(h => ({ date: h.date, supporters: h.supporters }));
    }

    // X一日平均を計算
    const xAverages: { [key: string]: XDailyAverage } = {};
    for (const [name, history] of xHistory) {
      const avg = calculateXDailyAverage(history);
      if (avg) {
        xAverages[name] = avg;
      }
    }

    // 5. JSON出力 (GitHub上のWebサイト用)
    const rankingData = {
      updated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      ranking: sorted.map(m => {
        const owner = owners.find(o => o.name === m.name);
        const xAvg = xAverages[m.name];
        return {
          name: m.name,
          supporters: m.financie.supporters,
          weeklyPosts: m.financie.weeklyPosts,
          lastPost: m.financie.lastPostTime 
            ? m.financie.lastPostTime.split('T')[0] 
            : null,
          financieUrl: owner?.financieUrl || null,
          xId: owner?.xId || null,
          xFollowers: m.x.followers,
          xPosts: m.x.totalPosts,
          xAvgFollowersPerDay: xAvg?.avgFollowersPerDay || 0,
          xAvgPostsPerDay: xAvg?.avgPostsPerDay || 0,
          xTotalDays: xAvg?.totalDays || 0,
        };
      }),
      history: historyData,
      xHistory: Object.fromEntries(xHistory),
    };
    
    const docsDir = path.join(process.cwd(), 'docs', 'data');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(docsDir, 'ranking.json'),
      JSON.stringify(rankingData, null, 2)
    );
    logger.info('Exported ranking.json for GitHub Pages');

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
