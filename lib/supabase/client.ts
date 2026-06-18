import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * ブラウザ（Client Component）用の Supabase クライアント。
 * anon key を使うため RLS が有効。ユーザー自身のデータのみアクセス可。
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
