// src/scrapers/financie.ts

import { Page } from 'playwright';
import { FinancieMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { randomDelay } from '../utils/delay';

const parseNumber = (text: string | null): number => {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
};

const isWithin24Hours = (timeText: string): boolean => {
  if (!timeText) return false;
  
  const text = timeText.trim();
  
  if (text.includes('分前') || text.includes('時間前')) {
    return true;
  }
  
  if (text === '1日前' || text.includes('1日前')) {
    return true;
  }
  
  if (text.includes('秒前') || text.includes('たった今') || text.includes('今')) {
    return true;
  }
  
  const dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (dateMatch) {
    const [, year, month, day, hour, minute] = dateMatch;
    const postDate = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );
    
    const now = new Date();
    const diffMs = now.getTime() - postDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    return diffHours >= 0 && diffHours <= 24;
  }
  
  const dateOnlyMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const postDate = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    );
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    
    return postDate >= yesterday;
  }
  
  // ISO形式の日付（datetime属性用）
  if (text.match(/^\d{4}-\d{2}-\d{2}/)) {
    const postDate = new Date(text);
    const now = new Date();
    const diffMs = now.getTime() - postDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 24;
  }
  
  return false;
};

/**
 * window.NUXT からサポーター数を抽出
 */
const extractFromNuxt = (html: string): number | null => {
  try {
    // window.__NUXT__ または window.NUXT を探す
    const patterns = [
      /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
      /window\.NUXT\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
      /__NUXT__\s*=\s*(\{[\s\S]*?\});/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // JSONをパースしやすい形に整形
        let jsonStr = match[1];
        
        // 関数呼び出しを除去（Nuxt3形式対応）
        jsonStr = jsonStr.replace(/\w+\([^)]*\)/g, 'null');
        
        try {
          const data = JSON.parse(jsonStr);
          
          // 様々なパスを試す
          const supporters = 
            data?.state?.owner?.supporters_count ??
            data?.data?.[0]?.owner?.supporters_count ??
            data?.payload?.owner?.supporters_count ??
            data?.state?.community?.supporters_count ??
            null;
          
          if (supporters !== null) {
            logger.info(`  NUXT extract: supporters=${supporters}`);
            return supporters;
          }
        } catch (e) {
          // パース失敗、次のパターンを試す
        }
      }
    }
    
    // サポーター数を直接HTMLから探す
    const supporterMatch = html.match(/supporters_count['":\s]+(\d+)/);
    if (supporterMatch) {
      const count = parseInt(supporterMatch[1], 10);
      logger.info(`  Regex extract: supporters=${count}`);
      return count;
    }
    
    return null;
  } catch (e) {
    return null;
  }
};

export const scrapeFinancie = async (
  page: Page,
  url: string
): Promise<ScrapeResult<FinancieMetrics>> => {
  try {
    logger.info(`Scraping FiNANCiE: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2, 4);
    
    // HTMLを取得
    const html = await page.content();
    
    // ========== サポーター数を取得 ==========
    let supporters = 0;
    
    // 方法1: NUXTデータから抽出
    const nuxtSupporters = extractFromNuxt(html);
    if (nuxtSupporters !== null && nuxtSupporters > 0) {
      supporters = nuxtSupporters;
      logger.info(`Found supporters from NUXT: ${supporters}`);
    }
    
    // 方法2: DOMセレクターから取得
    if (supporters === 0) {
      const selectors = [
        '.profile_databox .profile_num span span',
        'div:has-text("サポーター") span',
        '[class*="supporter"] span',
        '[class*="member"] span',
      ];
      
      for (const selector of selectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            const text = await el.textContent();
            const num = parseNumber(text);
            if (num > 0) {
              supporters = num;
              logger.info(`Found supporters with "${selector}": ${supporters}`);
              break;
            }
          }
        } catch (e) {
          // 次のセレクターを試す
        }
      }
    }
    
    // 方法3: テキストマッチング
    if (supporters === 0) {
      const match = html.match(/(\d[\d,]*)\s*(メンバー|人|サポーター)/);
      if (match) {
        supporters = parseNumber(match[1]);
        logger.info(`Found supporters from text: ${supporters}`);
      }
    }

    // ========== 活動報告リンクを取得 ==========
    let activityLogUrl = '';
    
    // 複数のセレクターパターン
    const linkSelectors = [
      'a[href*="activity_log"]',
      'a[href*="activities"]',
      'a[href*="activity"]',
      'a[data-tab-name="news"]',
      'a[data-tab="activities"]',
      'a[data-tab="news"]',
    ];
    
    for (const selector of linkSelectors) {
      try {
        const link = await page.$(selector);
        if (link) {
          const href = await link.getAttribute('href');
          if (href && (href.includes('activity') || href.includes('news'))) {
            activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
            logger.info(`Found activity URL with "${selector}": ${activityLogUrl}`);
            break;
          }
        }
      } catch (e) {
        // 次のセレクターを試す
      }
    }
    
    // HTMLから直接検索
    if (!activityLogUrl) {
      const linkMatch = html.match(/href="([^"]*(?:activity_log|activities|activity)[^"]*)"/);
      if (linkMatch) {
        const href = linkMatch[1];
        activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
        logger.info(`Found activity URL from HTML: ${activityLogUrl}`);
      }
    }

    // ========== 活動報告ページで最新投稿時間を取得 ==========
    let lastPostTime: string | null = '不明';
    let isActive = false;
    
    if (activityLogUrl) {
      await randomDelay(3, 5);
      
      try {
        await page.goto(activityLogUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await randomDelay(2, 3);
        
        // datetime属性を優先的に取得
        const timeEl = await page.$('time[datetime]');
        if (timeEl) {
          const datetime = await timeEl.getAttribute('datetime');
          if (datetime) {
            lastPostTime = datetime;
            logger.info(`Found datetime attribute: ${lastPostTime}`);
          }
        }
        
        // テキストから取得
        if (lastPostTime === '不明') {
          const timeSelectors = [
            'time',
            '[class*="time"]',
            '[class*="date"]',
          ];
          
          for (const selector of timeSelectors) {
            try {
              const el = await page.$(selector);
              if (el) {
                const text = await el.textContent();
                if (text && text.trim()) {
                  lastPostTime = text.trim();
                  logger.info(`Found time with "${selector}": ${lastPostTime}`);
                  break;
                }
              }
            } catch (e) {
              // 次のセレクターを試す
            }
          }
        }
        
        // ページ内テキストから検索
        if (lastPostTime === '不明') {
          const pageContent = await page.content();
          const timePatterns = [
            /(\d+秒前)/,
            /(\d+分前)/,
            /(\d+時間前)/,
            /(\d+日前)/,
            /(たった今)/,
            /(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})/,
            /datetime="([^"]+)"/,
          ];
          
          for (const pattern of timePatterns) {
            const match = pageContent.match(pattern);
            if (match) {
              lastPostTime = match[1];
              logger.info(`Found time from regex: ${lastPostTime}`);
              break;
            }
          }
        }
        
        isActive = isWithin24Hours(lastPostTime || '');
        logger.info(`Active status: ${isActive ? '◎ Active' : '× Inactive'} (${lastPostTime})`);
        
      } catch (e) {
        logger.warn(`Failed to scrape activity log: ${e}`);
      }
    } else {
      logger.warn('Activity log URL not found');
    }
    
    logger.info(`FiNANCiE final: supporters=${supporters}, lastPost="${lastPostTime}", active=${isActive}`);
    
    return {
      success: true,
      data: { 
        supporters, 
        totalPosts: 0,
        lastPostTime, 
        isActive 
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`FiNANCiE scrape failed: ${url}`, { error: errorMessage });
    
    return {
      success: false,
      error: errorMessage,
    };
  }
};
