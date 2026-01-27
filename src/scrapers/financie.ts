import { Page } from 'playwright';
import { FinancieMetrics, ScrapeResult } from '../types';
import { logger } from '../utils/logger';

export async function scrapeFinancie(
  page: Page,
  url: string
): Promise<ScrapeResult<FinancieMetrics>> {
  let supporters = 0;
  let weekly = 0;
  let lastIso: string | null = null;

  try {
    logger.info(`[Fi] Navigating: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ========================================
    // サポーター数取得: window.NUXT
    // ========================================
    try {
      supporters = await page.evaluate(`
        (function() {
          var raw = window.__NUXT__ || window.NUXT;
          if (typeof raw === 'string') {
            try { raw = JSON.parse(decodeURIComponent(raw)); }
            catch(e) { return 0; }
          }
          if (!raw) return 0;
          return (
            (raw.state && raw.state.owner && raw.state.owner.supporters_count) ||
            (raw.data && raw.data[0] && raw.data[0].owner && raw.data[0].owner.supporters_count) ||
            (raw.state && raw.state.community && raw.state.community.supporters_count) ||
            (raw.payload && raw.payload.owner && raw.payload.owner.supporters_count) ||
            0
          );
        })()
      `);
      
      if (supporters > 0) {
        logger.info(`[Fi] Supporters from NUXT: ${supporters}`);
      }
    } catch (nuxtError) {
      logger.warn(`[Fi] NUXT extraction failed: ${nuxtError}`);
    }

    // ========================================
    // フォールバック: DOM セレクタ
    // ========================================
    if (supporters === 0) {
      const selectors = [
        '.profile_databox .profile_num span span',
        '.profile-stat-num',
        '[class*="supporter"]',
        '[class*="Supporter"]'
      ];
      
      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const text = await el.textContent();
            const num = parseInt((text || '').replace(/[^\d]/g, ''), 10);
            if (num > 0) {
              supporters = num;
              logger.info(`[Fi] Supporters from selector "${sel}": ${supporters}`);
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }

    if (supporters === 0) {
      logger.warn(`[Fi] supporters=0 → ${url}`);
    } else {
      logger.info(`[Fi] Final supporters: ${supporters}`);
    }

    // ========================================
    // アクティビティページへ遷移
    // ========================================
    const activitySelector = [
      'a[href$="activities"]',
      'a[href$="activity"]',
      'a[href*="activity_log"]',
      'a[data-tab="activities"]',
      'a[data-tab="activity"]',
      'a[data-tab-name="news"]',
      'button[data-tab="activity"]',
      'button[data-tab="activities"]'
    ].join(', ');
    
    const activityLink = await page.$(activitySelector);
    
    if (activityLink) {
      await Promise.all([
        page.waitForResponse(
          r => /\/(activities|activity_log)/.test(r.url()) && r.status() === 200,
          { timeout: 10000 }
        ).catch(() => {}),
        activityLink.click()
      ]);
      
      await page.waitForTimeout(2000);
      logger.info('[Fi] Navigated to activity page');

      // ========================================
      // 投稿時間を取得（複数形式対応）
      // ========================================
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const seen = new Set<number>();

      for (let i = 0; i < 12; i++) {
        // ページ全体のテキストから日付を抽出
        const pageText: string = await page.evaluate(`document.body.innerText`);
        
        // 形式1: 「2026年01月26日 18:49」
        const absoluteDates = pageText.match(/\d{4}年\d{2}月\d{2}日\s*\d{2}:\d{2}/g) || [];
        absoluteDates.forEach(dateStr => {
          const match = dateStr.match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{2}):(\d{2})/);
          if (match) {
            const [, year, month, day, hour, minute] = match;
            const ts = new Date(
              parseInt(year, 10),
              parseInt(month, 10) - 1,
              parseInt(day, 10),
              parseInt(hour, 10),
              parseInt(minute, 10)
            ).getTime();
            if (!isNaN(ts)) seen.add(ts);
          }
        });

        // 形式2: 「2026年01月26日」（時間なし）
        const dateOnly = pageText.match(/\d{4}年\d{2}月\d{2}日(?!\s*\d{2}:)/g) || [];
        dateOnly.forEach(dateStr => {
          const match = dateStr.match(/(\d{4})年(\d{2})月(\d{2})日/);
          if (match) {
            const [, year, month, day] = match;
            const ts = new Date(
              parseInt(year, 10),
              parseInt(month, 10) - 1,
              parseInt(day, 10),
              12, 0
            ).getTime();
            if (!isNaN(ts)) seen.add(ts);
          }
        });

        // 形式3: 「〇日前」「〇時間前」「〇分前」
        const relativePatterns = pageText.match(/(\d+)(日|時間|分|秒)前/g) || [];
        relativePatterns.forEach(s => {
          const daysMatch = s.match(/(\d+)日前/);
          if (daysMatch) {
            const days = parseInt(daysMatch[1], 10);
            if (days <= 7) {
              seen.add(now - days * 24 * 60 * 60 * 1000);
            }
          }
          const hoursMatch = s.match(/(\d+)時間前/);
          if (hoursMatch) {
            seen.add(now - parseInt(hoursMatch[1], 10) * 60 * 60 * 1000);
          }
          const minsMatch = s.match(/(\d+)分前/);
          if (minsMatch) {
            seen.add(now - parseInt(minsMatch[1], 10) * 60 * 1000);
          }
        });

        // 「たった今」
        if (pageText.includes('たった今')) {
          seen.add(now);
        }

        logger.info(`[Fi] Scroll ${i + 1}: found ${seen.size} dates`);

        // 7日より古い投稿に到達したら終了
        if (seen.size > 0) {
          const oldest = Math.min(...seen);
          if (now - oldest > weekMs) {
            logger.info(`[Fi] Reached 7d boundary at scroll ${i + 1}`);
            break;
          }
        }

        await page.evaluate('window.scrollBy(0, 1200)');
        await page.waitForTimeout(600);
      }

      // ========================================
      // 7日以内の投稿をカウント
      // ========================================
      const recentPosts = [...seen].filter(t => now - t <= weekMs);
      weekly = recentPosts.length;

      if (seen.size > 0) {
        const latestTs = Math.max(...seen);
        lastIso = new Date(latestTs).toISOString();
      }

      logger.info(`[Fi] Weekly posts: ${weekly}, Last post: ${lastIso}`);

    } else {
      logger.warn(`[Fi] Activity link not found: ${url}`);
    }

    return {
      success: true,
      data: {
        supporters,
        weeklyPosts: weekly,
        lastPostTime: lastIso
      }
    };

  } catch (error) {
    logger.error(`[Fi] Scrape failed: ${url} - ${error}`);
    return {
      success: false,
      error: String(error)
    };
  }
}
