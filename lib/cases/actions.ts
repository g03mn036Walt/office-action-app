"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";

/**
 * 案件 CRUD の Server Actions（PRD §14 タスク6 / §9.2）。
 * すべて requireUser で認証し、RLS と合わせて owner のデータのみ操作する。
 *
 * 注意: createCase は redirect せず新 ID を返す。呼び出し側（Client）が
 * router.push で遷移する（Server Action 内 redirect の try/catch 落とし穴回避）。
 */

export type CreateCaseInput = {
  publicationNumber: string;
  country: string;
};

/** 新規案件を作成し、作成された案件 ID を返す。 */
export async function createCase(input: CreateCaseInput): Promise<{ id: string }> {
  const { supabase, user } = await requireUser();

  const publicationNumber = input.publicationNumber.trim();
  // title は一覧表示用。未入力なら公報番号、それも無ければ「無題」。
  const title = publicationNumber || "無題";

  const { data, error } = await supabase
    .from("cases")
    .insert({
      user_id: user.id,
      publication_number: publicationNumber || null,
      country: input.country,
      title,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "案件の作成に失敗しました");
  }

  revalidatePath("/", "layout");
  return { id: data.id };
}

/** 案件を削除する（子レコードは FK の on delete cascade で消える）。 */
export async function deleteCase(id: string): Promise<void> {
  const { supabase } = await requireUser();

  const { error } = await supabase.from("cases").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/", "layout");
}

/** お気に入りの登録/解除を切り替える。 */
export async function setFavorite(id: string, isFavorite: boolean): Promise<void> {
  const { supabase } = await requireUser();

  const { error } = await supabase
    .from("cases")
    .update({ is_favorite: isFavorite })
    .eq("id", id);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/", "layout");
}
