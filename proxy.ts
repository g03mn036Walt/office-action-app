import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/session";

// Next.js 16 で Middleware は Proxy に改称された（機能は同じ）。
// リクエストごとに Supabase セッションを更新する。
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // 静的アセットと画像以外の全パスで実行
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
