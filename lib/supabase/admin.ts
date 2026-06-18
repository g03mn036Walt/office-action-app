import "server-only";

import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";

/**
 * service_role（secret key）を使うサーバー専用の管理クライアント。RLS をバイパスする。
 *
 * `import "server-only"` により、誤ってクライアントから import するとビルドで失敗する。
 * service_role キーは NEXT_PUBLIC を付けず、このモジュール内でのみ参照する。
 * セッションは持たない（サーバー間処理専用）。
 */
function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }
  return key;
}

export function createAdminClient() {
  return createClient(SUPABASE_URL, requireServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
