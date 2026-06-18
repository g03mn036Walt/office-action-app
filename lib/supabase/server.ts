import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * サーバー（Server Component / Route Handler / Server Action）用の Supabase クライアント。
 * anon key を使うため RLS が有効。リクエストごとに新規生成すること（使い回し禁止）。
 *
 * Next.js 16 の `cookies()` は async。getAll/setAll でセッション Cookie を読み書きする。
 * Server Component からは Cookie 書き込みができないため、setAll は try/catch で握り、
 * セッションの更新は middleware（0-4 で実装）に委ねる。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component から呼ばれた場合は書き込めない。middleware 側で更新する。
        }
      },
    },
  });
}
