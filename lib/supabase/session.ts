import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** 認証不要なパス（未ログインでもアクセスさせる）。 */
function isPublicPath(pathname: string): boolean {
  return pathname.startsWith("/login") || pathname.startsWith("/auth");
}

/**
 * Proxy（旧 middleware）から呼び、リクエストごとにセッションを更新する。
 * getUser() がトークンをリフレッシュし、更新後の Cookie をレスポンスに書き戻す。
 * 未認証で保護パスにアクセスした場合は /login へリダイレクトする。
 *
 * 注意: createServerClient と getUser() の間に処理を挟まないこと（公式の推奨）。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
