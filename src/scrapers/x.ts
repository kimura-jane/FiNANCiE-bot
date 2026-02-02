// 1. 全オーナーのX IDを取得
const xIds = owners.map(o => o.xId).filter((id): id is string => !!id);

// 2. Xのデータを「一括」で取る (ここで0.75円消費)
const xMetricsMap = await fetchXMetricsBatch(xIds, process.env.X_BEARER_TOKEN!);

// 3. 各オーナーのデータを統合してHistoryへ
for (const owner of owners) {
  const fData = await scrapeFinancie(page, owner.financieUrl!);
  const xData = xMetricsMap.get(owner.xId?.replace('@', '').toLowerCase() || '') || { followers: 0, totalPosts: 0, updatedAt: null };
  
  // ここでスプレッドシートのHistory行を作成し、appendHistoryを実行
}
