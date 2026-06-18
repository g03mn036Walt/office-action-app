import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// 認証ガード付きのホーム。本格的な 2 カラム UI は 1-1 で実装する。
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // proxy でも弾くが、Server Component 側でも検証する（認可はここで担保）。
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-8 dark:bg-black">
      <p className="text-lg text-zinc-800 dark:text-zinc-100">
        ログイン中: <span className="font-medium">{user.email}</span>
      </p>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-full bg-zinc-900 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          ログアウト
        </button>
      </form>
    </main>
  );
}
