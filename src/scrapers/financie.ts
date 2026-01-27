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

/**
 * 日付文字列をDateオブジェクトに変換
 */
const parseDate = (timeText: string): Date | null => {
  if (!timeText) return null;
  
  const text = timeText.trim();
  const now = new Date();
  
  // 「〇秒前」
  const secMatch = text.match(/(\d+)秒前/);
  if (secMatch) {
    return new Date(now.getTime() - parseInt(secMatch[1]) * 1000);
  }
  
  // 「〇分前」
  const minMatch = text.match(/(\d+)分前/);
  if (minMatch) {
    return new Date(now.getTime() - parseInt(minMatch[1]) * 60 * 1000);
  }
  
  // 「〇時間前」
  const hourMatch = text.match(/(\d+)時間前/);
  if (hourMatch) {
    return new Date(now.getTime() - parseInt(hourMatch[1]) * 60 * 60 * 1000);
  }
  
  // 「〇日前」
  const dayMatch = text.match(/(\d+)日前/);
  if (dayMatch) {
    return new Date(now.getTime() - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000);
  }
  
  // 「たった今」
  if (text.includes('たった今') || text === '今') {
    return now;
  }
  
  // 絶対日付形式（例: 2026年01月25日 13:05）
  const dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (dateMatch) {
    const [, year, month, day, hour, minute] = dateMatch;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );
  }
  
  // 日付のみ形式（例: 2026年01月25日）
  const dateOnlyMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      12, 0, 0
    );
  }
  
  // ISO形式
  if (text.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(text);
  }
  
  return null;
};

/**
 * 直近7日以内かどうか判定
 */
const isWithinWeek = (date: Date): boolean => {
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return (now.getTime() - date.getTime()) <= weekMs;
};

export const scrapeFinancie = async (
  page: Page,
  url: string
): Promise<ScrapeResult<FinancieMetrics>> => {
  try {
    logger.info(`Scraping FiNANCiE: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2, 4);
    
    const html = await page.content();
    
    // ========== サポーター数を取得 ==========
    let supporters = 0;
    
    // 方法1: DOMセレクターから取得
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
    
    // 方法2: テキストマッチング
    if (supporters === 0) {
      const match = html.match(/(\d[\d,]*)\s*(メンバー|人|サポーター)/);
      if (match) {
        supporters = parseNumber(match[1]);
        logger.info(`Found supporters from text: ${supporters}`);
      }
    }

    // ========== 活動報告リンクを取得 ==========
    let activityLogUrl = '';
    
    const linkSelectors = [
      'a[href*="activity_log"]',
      'a[href*="activities"]',
      'a[href*="activity"]',
      'a[data-tab-name="news"]',
      'a[data-tab="activities"]',
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
    
    if (!activityLogUrl) {
      const linkMatch = html.match(/href="([^"]*(?:activity_log|activities|activity)[^"]*)"/);
      if (linkMatch) {
        const href = linkMatch[1];
        activityLogUrl = href.startsWith('http') ? href : `https://financie.jp${href}`;
        logger.info(`Found activity URL from HTML: ${activityLogUrl}`);
      }
    }

    // ========== 活動報告ページで投稿を取得 ==========
    let lastPostTime: string | null = '不明';
    let weeklyPosts = 0;
    
    if (activityLogUrl) {
      await randomDelay(3, 5);
      
      try {
        await page.goto(activityLogUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await randomDelay(2, 3);
        
        const postDates: Date[] = [];
        
        // スクロールして投稿を読み込む（最大3回）
        for (let scroll = 0; scroll < 3; scroll++) {
          // time要素を取得
          const timeElements = await page.$$('time');
          
          for (const timeEl of timeElements) {
            try {
              // datetime属性を優先
              let timeText = await timeEl.getAttribute('datetime');
              if (!timeText) {
                timeText = await timeEl.textContent();
              }
              
              if (timeText) {
                const date = parseDate(timeText.trim());
                if (date) {
                  // 重複チェック
                  const exists = postDates.some(d => 
                    Math.abs(d.getTime() - date.getTime()) < 60000
                  );
                  if (!exists) {
                    postDates.push(date);
                  }
                }
              }
            } catch (e) {
              // 次の要素へ
            }
          }
          
          // 7日より古い投稿があれば終了
          const oldestInView = postDates.filter(d => !isWithinWeek(d));
          if (oldestInView.length > 0) {
            break;
          }
          
          // スクロール
          await page.mouse.wheel(0, 1200);
          await randomDelay(0.5, 1);
        }
        
        // 最新投稿日時
        if (postDates.length > 0) {
          postDates.sort((a, b) => b.getTime() - a.getTime());
          lastPostTime = postDates[0].toISOString().split('T')[0] + ' ' + 
                         postDates[0].toTimeString().slice(0, 5);
        }
        
        // 週間投稿数
        weeklyPosts = postDates.filter(d => isWithinWeek(d)).length;
        
        logger.info(`Found ${postDates.length} posts, ${weeklyPosts} in last 7 days`);
        logger.info(`Last post: ${lastPostTime}`);
        
      } catch (e) {
        logger.warn(`Failed to scrape activity log: ${e}`);
      }
    } else {
      logger.warn('Activity log URL not found');
    }
    
    logger.info(`FiNANCiE final: supporters=${supporters}, weeklyPosts=${weeklyPosts}, lastPost="${lastPostTime}"`);
    
    return {
      success: true,
      data: { 
        supporters, 
        weeklyPosts,
        lastPostTime, 
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
