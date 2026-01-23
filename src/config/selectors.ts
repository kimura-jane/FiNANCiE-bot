/**
 * セレクター定数
 * サイト構造が変更された場合、ここだけ修正すればOK
 */

export const FINANCIE_SELECTORS = {
  // サポーター数（コミュニティメンバー数）
  // 例: "1,234 メンバー" のような表示
  SUPPORTERS: '[data-testid="community-members"], .community-member-count, .supporter-count',
  
  // フィード投稿数
  // プロフィールページの投稿タブに表示される数値
  TOTAL_POSTS: '[data-testid="post-count"], .feed-count, .post-count',
  
  // ページ読み込み完了の確認用
  PAGE_LOADED: '.profile-container, [data-testid="profile"], main',
} as const;

export const X_SELECTORS = {
  // フォロワー数
  // 例: "1,234 Followers" または "1,234 フォロワー"
  FOLLOWERS: '[data-testid="followersLink"], a[href$="/verified_followers"]',
  
  // 総ポスト数
  // プロフィールヘッダーに表示される投稿数
  TOTAL_POSTS: '[data-testid="postsCount"], .posts-count',
  
  // ページ読み込み完了の確認用
  PAGE_LOADED: '[data-testid="primaryColumn"], [data-testid="UserName"]',
  
  // ログイン要求モーダル（検出用）
  LOGIN_MODAL: '[data-testid="loginButton"], [role="dialog"]',
} as const;

/**
 * User-Agentリスト（ランダム選択用）
 */
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
] as const;
