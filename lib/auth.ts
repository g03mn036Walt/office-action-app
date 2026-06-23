import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * 認証済みユーザーを取得する共通ガード（Server Component / Server Action 用）。
 *
 * proxy.ts（旧 middleware）でも未認証は /login にリダイレクトされるが、
 * Server Action は直接 POST されうるため、ここでも検証する（二重防御）。
 * 取得した user.id と RLS により owner 限定アクセスを担保する。
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, user };
}
