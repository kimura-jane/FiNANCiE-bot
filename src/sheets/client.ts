import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Owner, DailyMetrics, ScoredMetrics } from '../types';
import { logger } from '../utils/logger';

const TIMEZONE = 'Asia/Tokyo';

/**
 * Google Sheets クライアント
 */
export class SheetsClient {
  private doc: GoogleSpreadsheet;
  private initialized = false;

  constructor() {
    const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
    const sheetId = process.env.GOOGLE_SHEET_ID || '';
    
    logger.info(`Sheet ID: ${sheetId}`);
    logger.info(`JSON length: ${jsonStr.length}`);
    
    let credentials;
    try {
      credentials = JSON.parse(jsonStr);
      logger.info(`Parsed client_email: ${credentials.client_email}`);
    } catch (e) {
      logger.error(`JSON parse error: ${e}`);
      throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON');
    }
    
    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.doc = new GoogleSpreadsheet(sheetId, auth);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Attempting to load spreadsheet...');
    await this.doc.loadInfo();
    this.initialized = true;
    logger.info(`Connected to spreadsheet: ${this.doc.title}`);
  }

  getTodayDate(): string {
    const now = new Date();
    const jstDate = toZonedTime(now, TIMEZONE);
    return format(jstDate, 'yyyy-MM-dd');
  }

  async getOwners(): Promise<Owner[]> {
    await this.init();
    
    const sheet = this.doc.sheetsByTitle['Owners'];
    if (!sheet) {
      throw new Error('Owners sheet not found');
    }

    const rows = await sheet.getRows();
    const owners: Owner[] = [];

    for (const row of rows) {
      const name = row.get('名前') || row.get('name') || '';
      const financieUrl = row.get('FiNANCiE URL') || row.get('financie_url') || '';
      const xId = row.get('X ID') || row.get('x_id') || '';

      if (name && (financieUrl || xId)) {
        owners.push({ name, financieUrl, xId });
      }
    }

    logger.info(`Loaded ${owners.length} owners from sheet`);
    return owners;
  }

  async getYesterdayMetrics(): Promise<Map<string, DailyMetrics>> {
    await this.init();
    
    const sheet = this.doc.sheetsByTitle['History'];
    if (!sheet) {
      logger.warn('History sheet not found, returning empty data');
      return new Map();
    }

    const rows = await sheet.getRows();
    const metricsMap = new Map<string, DailyMetrics>();
    const today = this.getTodayDate();
    
    for (const row of rows) {
      const date = row.get('date') || '';
      const name = row.get('name') || '';
      
      if (date && date !== today && name) {
        const existing = metricsMap.get(name);
        if (!existing || existing.date < date) {
          metricsMap.set(name, {
            date,
            name,
            financie: {
              supporters: parseInt(row.get('financie_supporters') || '0', 10),
              lastPostTime: row.get('last_post_time') || '不明',
              isActive: row.get('is_active') === '◎',
            },
            x: {
              followers: parseInt(row.get('x_followers') || '0', 10),
              totalPosts: parseInt(row.get('x_posts') || '0', 10),
            },
          });
        }
      }
    }

    logger.info(`Loaded yesterday metrics for ${metricsMap.size} owners`);
    return metricsMap;
  }

  async appendHistory(metrics: DailyMetrics[]): Promise<void> {
    await this.init();
    
    let sheet = this.doc.sheetsByTitle['History'];
    if (!sheet) {
      sheet = await this.doc.addSheet({
        title: 'History',
        headerValues: [
          'date', 'name',
          'financie_supporters', 'last_post_time', 'is_active',
          'x_followers', 'x_posts'
        ],
      });
    }

    const rows = metrics.map(m => ({
      date: m.date,
      name: m.name,
      financie_supporters: m.financie.supporters,
      last_post_time: m.financie.lastPostTime,
      is_active: m.financie.isActive ? '◎' : '×',
      x_followers: m.x.followers,
      x_posts: m.x.totalPosts,
    }));

    await sheet.addRows(rows);
    logger.info(`Appended ${rows.length} rows to History sheet`);
  }

  async updateRanking(scoredMetrics: ScoredMetrics[]): Promise<void> {
    await this.init();
    
    let sheet = this.doc.sheetsByTitle['Ranking'];
    if (!sheet) {
      sheet = await this.doc.addSheet({
        title: 'Ranking',
        headerValues: [
          'rank', 'name', 'score',
          'active', 'last_post_time',
          'supporters', 'delta_supporters',
          'x_followers', 'delta_followers',
          'date'
        ],
      });
    }

    await sheet.clearRows();

    const sorted = [...scoredMetrics].sort((a, b) => b.score - a.score);

    const rows = sorted.map((m, index) => ({
      rank: index + 1,
      name: m.name,
      score: m.score,
      active: m.financie.isActive ? '◎' : '×',
      last_post_time: m.financie.lastPostTime,
      supporters: m.financie.supporters,
      delta_supporters: m.delta.supporters,
      x_followers: m.x.followers,
      delta_followers: m.delta.followers,
      date: m.date,
    }));

    await sheet.addRows(rows);
    logger.info(`Updated Ranking sheet with ${rows.length} rows`);
  }
}
