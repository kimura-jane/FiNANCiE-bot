// src/scrapers/X.ts からインポート
import { fetchXMetricsBatch } from './scrapers/X';

async function main() {
  const sheets = new SheetsClient();
  const owners = await sheets.getOwners();
  
  // --- 1. Xデータを「一括」で取得 (消費: 0.75円) ---
  const xIds = owners.map(o => o.xId).filter((id): id is string => !!id);
  // GitHub ActionsのSecretsに X_BEARER_TOKEN を追加しておく
  const xMetricsMap = await fetchXMetricsBatch(xIds, process.env.X_BEARER_TOKEN!);

  const dailyMetrics: DailyMetrics[] = [];

  // --- 2. 各オーナーのループ ---
  for (const owner of owners) {
    // FiNANCiEのスクレイピング (既存の処理)
    const fResult = await scrapeFinancie(page, owner.financieUrl!);
    
    // Xのデータをマップから取り出す (APIは叩かないのでタダ)
    const xKey = owner.xId?.replace('@', '').toLowerCase() || '';
    const xData = xMetricsMap.get(xKey) || { followers: 0, totalPosts: 0, updatedAt: null };

    dailyMetrics.push({
      date: sheets.getTodayDate(),
      name: owner.name,
      financie: fResult.data,
      x: xData // ここでXのデータが統合される
    });
  }

  // --- 3. スプシへの記録とJSONの書き出し ---
  await sheets.appendHistory(dailyMetrics);
  // ここで書き出す ranking.json にも xFollowers, xPosts を含めるように修正
}
