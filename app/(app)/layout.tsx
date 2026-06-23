import { Sidebar, type CaseListItem } from "@/components/app/Sidebar";
import { requireUser } from "@/lib/auth";

/**
 * アプリのシェル（Claude Design: AppShell.dc.html の2カラム構造）。
 * 左にサイドバー（案件リスト）、右にメイン（各案件のチャット等 = children）。
 *
 * 案件リストはここで取得する。お気に入りを上に、続いて更新日時の新しい順。
 * 作成/削除/お気に入り更新後は Server Action 側の revalidatePath で再取得される。
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireUser();

  const { data: cases } = await supabase
    .from("cases")
    .select("id, title, publication_number, country, current_step, is_favorite")
    .order("is_favorite", { ascending: false })
    .order("updated_at", { ascending: false });

  const userName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "ユーザー";

  return (
    <div className="grid h-screen grid-cols-[280px_1fr] overflow-hidden">
      <Sidebar cases={(cases as CaseListItem[]) ?? []} userName={userName} />
      <main className="flex h-screen flex-col overflow-hidden bg-cream">{children}</main>
    </div>
  );
}
