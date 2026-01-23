import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { USER_AGENTS } from '../config/selectors';
import { getRandomUserAgent } from './delay';
import { logger } from './logger';

/**
 * Playwrightブラウザ管理
 */

let browser: Browser | null = null;

export const launchBrowser = async (): Promise<Browser> => {
  if (browser) return browser;

  logger.info('Launching browser...');
  
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });

  return browser;
};

export const createContext = async (browser: Browser): Promise<BrowserContext> => {
  const userAgent = getRandomUserAgent(USER_AGENTS);
  
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    // 検知回避のための設定
    javaScriptEnabled: true,
    bypassCSP: true,
  });

  // WebDriverフラグを隠す
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  return context;
};

export const createPage = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage();
  
  // タイムアウト設定
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  
  return page;
};

export const closeBrowser = async (): Promise<void> => {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Browser closed');
  }
};
