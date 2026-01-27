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
    // サポーター数取得: window.NUXT（URL-encode対応）
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

    // supporters=0 の警告
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
      'a[data-tab-name="news"]'
    ].join(', ');
    
    const activityLink = await page.$(activitySelector);
    
    if (activityLink) {
      await Promise.all([
        page.waitForResponse(
          r => r.url().includes('activit') && r.status() === 200,
          { timeout: 10000 }
        ).catch(() => {}),
        activityLink.click()
      ]);
      
      await page.waitForTimeout(1500);
      logger.info('[Fi] Navigated to activity page');

      // ========================================
      // 無限スクロールで7日分の投稿を取得
      // ========================================
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const seen = new Set<number>();

      for (let i = 0; i < 12; i++) {
        const times: string[] = await page.evaluate(`
          Array.from(document.querySelectorAll('time[datetime]'))
            .map(function(e) { return e.getAttribute('datetime'); })
            .filter(function(t) { return t; })
        `);
        
        times.forEach(t => {
          if (t) {
            const ts = new Date(t).getTime();
            if (!isNaN(ts)) seen.add(ts);
          }
        });

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
      // 相対時間表記のフォールバック
      // ========================================
      if (seen.size < 3) {
        try {
          const relTimes: string[] = await page.evaluate(`
            Array.from(document.querySelectorAll('[class*="time"], [class*="date"], [class*="ago"]'))
              .map(function(e) { return e.textContent ? e.textContent.trim() : ''; })
          `);
          
          relTimes.forEach(s => {
            const daysMatch = s.match(/(\d+)日前/);
            if (daysMatch && parseInt(daysMatch[1], 10) <= 6) {
              seen.add(now - parseInt(daysMatch[1], 10) * 24 * 60 * 60 * 1000);
            }
            if (s.includes('時間前') || s.includes('分前') || s.includes('秒前') || s.includes('たった今')) {
              seen.add(now);
            }
          });
          
          logger.info(`[Fi] Added relative times, total: ${seen.size}`);
        } catch {
          // ignore
        }
      }

      // ========================================
      // 7日以内の投稿をカウント
      // ========================================
      const recentPosts = [...seen].filter(t => now - t <= weekMs);
      weekly = recentPosts.length;

      if (seen.size > 0) {
        lastIso = new Date(Math.max(...seen)).toISOString();
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
