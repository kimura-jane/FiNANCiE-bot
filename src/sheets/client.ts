// src/sheets/client.ts

import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Owner, DailyMetrics, ScoredMetrics, FinancieMetrics, XMetrics } from '../types';
import { logger } from '../utils/logger';

export class SheetsClient {
  private doc: GoogleSpreadsheet;
  private initialized = false;

  constructor() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!sheetId) {
      throw new Error('GOOGLE_SHEET_ID is not set');
    }
    if (!serviceAccountJson) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    }

    const credentials = JSON.parse(serviceAccountJson);

    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.doc = new GoogleSpreadsheet(sheetId, auth);
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Loading spreadsheet...');
    await this.doc.loadInfo();
    logger.info(`Spreadsheet loaded: ${this.doc.title}`);
    this.initialized = true;
  }

  getTodayDate(): string {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().split('T')[0];
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

      if (name) {
        owners.push({
          name,
          financieUrl: financieUrl || null,
          xId: xId || null,
        });
      }
    }

    return owners;
  }

  async getYesterdayMetrics(): Promise<Map<string, DailyMetrics>> {
    await this.init();
    
    const sheet = this.doc.sheetsByTitle['History'];
    if (!sheet) {
      logger.warn('History sheet not found');
      return new Map();
    }

    const rows = await sheet.getRows();
    const metricsMap = new Map<string, DailyMetrics>();
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    for (const row of rows) {
      const date = row.get('date') || '';
      if (!date.startsWith(yesterdayStr)) continue;

      const name = row.get('name') || '';
      if (!name) continue;

      const financie: FinancieMetrics = {
        supporters: parseInt(row.get('supporters') || '0', 10) || 0,
        weeklyPosts: parseInt(row.get('weekly_posts') || '0', 10) || 0,
        lastPostTime: row.get('last_post') || null,
      };

      const x: XMetrics = {
        followers: parseInt(row.get('x_followers') || '0', 10) || 0,
        totalPosts: parseInt(row.get('x_posts') || '0', 10) || 0,
      };

      metricsMap.set(name, {
        date,
        name,
        financie,
        x,
      });
    }

    return metricsMap;
  }

  async appendHistory(metrics: DailyMetrics[]): Promise<void> {
    await this.init();
    
    let sheet = this.doc.sheetsByTitle['History'];
    if (!sheet) {
      sheet = await this.doc.addSheet({
        title: 'History',
        headerValues: [
          'date', 'name', 'supporters', 'weekly_posts', 'last_post',
          'x_followers', 'x_posts'
        ],
      });
      logger.info('Created History sheet');
    }

    const rows = metrics.map(m => ({
      date: m.date,
      name: m.name,
      supporters: m.financie.supporters,
      weekly_posts: m.financie.weeklyPosts,
      last_post: m.financie.lastPostTime || '',
      x_followers: m.x.followers,
      x_posts: m.x.totalPosts,
    }));

    await sheet.addRows(rows);
    logger.info(`Appended ${rows.length} rows to History`);
  }

  async updateRanking(metrics: ScoredMetrics[]): Promise<void> {
    await this.init();
    
    let sheet = this.doc.sheetsByTitle['Ranking'];
    if (!sheet) {
      sheet = await this.doc.addSheet({
        title: 'Ranking',
        headerValues: [
          'rank', 'name', 'score', 'supporters', 'weekly_posts', 'last_post',
          'x_followers', 'x_posts', 'date'
        ],
      });
      logger.info('Created Ranking sheet');
    }

    const existingRows = await sheet.getRows();
    for (const row of existingRows) {
      await row.delete();
    }

    const sorted = [...metrics].sort((a, b) => b.score - a.score);

    const rows = sorted.map((m, i) => ({
      rank: i + 1,
      name: m.name,
      score: m.score,
      supporters: m.financie.supporters,
      weekly_posts: m.financie.weeklyPosts,
      last_post: m.financie.lastPostTime || '',
      x_followers: m.x.followers,
      x_posts: m.x.totalPosts,
      date: m.date,
    }));

    await sheet.addRows(rows);
    logger.info(`Updated Ranking with ${rows.length} rows`);
  }
}
