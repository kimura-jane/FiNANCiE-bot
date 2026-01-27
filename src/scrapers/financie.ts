import { Page } from 'playwright';
import { FinancieMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

// 数値パース（カンマ対応）
function parseNumber(text: string | null): number {
  if (!text) return 0;
  const cleaned = text.replace(/[,\s人]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// 日付文字列をDateに変換
function parseJapaneseDate(dateStr: string): Date | null {
  // "2026年01月27日 18:49" 形式
  const match = dateStr.match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }
  
  // "2026年01月27日" 形式（時間なし）
  const dateOnly = dateStr.match(/(\d{4})年(\d{2})月(\d{2})日/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10)
    );
  }
  
  return null;
}

// 直近7日以内かチェック
function isWithin7Days(dateStr: string): boolean {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // 相対時間形式（「〇〇前」）
  if (dateStr.includes('秒前') || dateStr.includes('分前') || dateStr.includes('時間前')) {
    return true;
  }
  if (dateStr.includes('たった今') || dateStr.includes('今')) {
    return true;
  }
  
  // 「1日前」〜「6日前」
  const daysAgoMatch = dateStr.match(/(\d+)日前/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    return days <= 6;
  }
  
  // 絶対日付形式
  const postDate = parseJapaneseDate(dateStr);
  if (postDate) {
    return postDate >= sevenDaysAgo;
  }
  
  return false;
}

// window.NUXT からデータ抽出
function extractFromNuxt(html: string): { supporters: number } | null {
  const patterns = [
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/,
    /window\.NUXT\s*=\s*(\{[\s\S]*?\});/,
    /__NUXT__\s*=\s*(\{[\s\S]*?\});/
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        let jsonStr = match[1];
        if (!jsonStr.startsWith('{')) {
          jsonStr = decodeURIComponent(jsonStr);
        }
        
        const supportersMatch = jsonStr.match(/supporters_count["\s:]+(\d+)/);
        if (supportersMatch) {
          return { supporters: parseInt(supportersMatch[1], 10) };
        }
      } catch {
        continue;
      }
    }
  }
  
  const supportersRegex = /supporters_count["\s:]+(\d+)/;
  const match = html.match(supportersRegex);
  if (match) {
    return { supporters: parseInt(match[1], 10) };
  }
  
  return null;
}

export async function scrapeFinancie(
  page: Page,
  url: string
): Promise<ScrapeResult<FinancieMetrics>> {
  try {
    logger.info(`Navigating to FiNANCiE: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2, 4);
    
    // サポーター数を取得
    let supporters = 0;
    const html = await page.content();
    
    // 方法1: NUXT から取得
    const nuxtData = extractFromNuxt(html);
    if (nuxtData && nuxtData.supporters > 0) {
      supporters = nuxtData.supporters;
      logger.info(`Supporters from NUXT: ${supporters}`);
    }
    
    // 方法2: DOM セレクタから取得
    if (supporters === 0) {
      const selectors = [
        '.profile_databox .profile_num span span',
        '.profile-stat-num',
        '[class*="supporter"] [class*="num"]',
        '.supporter-count'
      ];
      
      for (const selector of selectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            const text = await element.textContent();
            supporters = parseNumber(text);
            if (supporters > 0) {
              logger.info(`Supporters from selector "${selector}": ${supporters}`);
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    // 方法3: ページ全体から正規表現で取得
    if (supporters === 0) {
      const supportersMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:人|サポーター)/);
      if (supportersMatch) {
        supporters = parseNumber(supportersMatch[1]);
        logger.info(`Supporters from regex: ${supporters}`);
      }
    }
    
    logger.info(`Final supporters count: ${supporters}`);
    
    // アクティビティログURLを探す
    let activityLogUrl: string | null = null;
    
    const linkSelectors = [
      'a[data-tab-name="news"]',
      'a[href*="activity_log"]',
      'a[href*="activities"]',
      'a[data-tab="activities"]',
      'a[data-tab="news"]'
    ];
    
    for (const selector of linkSelectors) {
      try {
        const link = await page.$(selector);
        if (link) {
          const href = await link.getAttribute('href');
          if (href) {
            activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
            logger.info(`Activity log URL found: ${activityLogUrl}`);
            break;
          }
        }
      } catch {
        continue;
      }
    }
    
    // HTML内からリンクを探す
    if (!activityLogUrl) {
      const activityMatch = html.match(/href="([^"]*(?:activity_log|activities)[^"]*)"/);
      if (activityMatch) {
        activityLogUrl = activityMatch[1].startsWith('http') 
          ? activityMatch[1] 
          : `https://financie.jp${activityMatch[1]}`;
        logger.info(`Activity log URL from HTML: ${activityLogUrl}`);
      }
    }
    
    // アクティビティログページへ移動して週間投稿数を取得
    let weeklyPosts = 0;
    let lastPostTime: string | null = null;
    
    if (activityLogUrl) {
      try {
        logger.info(`Navigating to activity log: ${activityLogUrl}`);
        await page.goto(activityLogUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await randomDelay(2, 3);
        
        // スクロールして投稿を読み込む（最大3回）
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await randomDelay(1, 2);
        }
        
        // 投稿の時間を取得
        const postTimes: string[] = [];
        const activityHtml = await page.content();
        
        // time要素から取得
        const timeElements = await page.$$('time');
        for (const el of timeElements) {
          const datetime = await el.getAttribute('datetime');
          if (datetime) {
            postTimes.push(datetime);
          } else {
            const text = await el.textContent();
            if (text && text.trim()) {
              postTimes.push(text.trim());
            }
          }
        }
        
        // ページ全体から時間パターンを探す
        if (postTimes.length === 0) {
          const timePatterns = [
            /(\d{4}年\d{2}月\d{2}日\s*\d{2}:\d{2})/g,
            /(\d+(?:秒|分|時間|日)前)/g,
            /(たった今)/g
          ];
          
          for (const pattern of timePatterns) {
            const matches = activityHtml.match(pattern);
            if (matches) {
              postTimes.push(...matches);
            }
          }
        }
        
        logger.info(`Found ${postTimes.length} post times`);
        
        // 最新投稿時間を設定
        if (postTimes.length > 0) {
          lastPostTime = postTimes[0];
          logger.info(`Last post time: ${lastPostTime}`);
        }
        
        // 7日以内の投稿をカウント
        for (const timeStr of postTimes) {
          if (isWithin7Days(timeStr)) {
            weeklyPosts++;
          }
        }
        
        logger.info(`Weekly posts (last 7 days): ${weeklyPosts}`);
        
      } catch (activityError) {
        logger.warn(`Activity log scrape failed: ${activityError}`);
      }
    } else {
      logger.warn('Activity log URL not found');
    }
    
    return {
      success: true,
      data: {
        supporters,
        weeklyPosts,
        lastPostTime
      }
    };
    
  } catch (error) {
    logger.error(`FiNANCiE scrape failed for ${url}: ${error}`);
    return {
      success: false,
      error: String(error)
    };
  }
}
