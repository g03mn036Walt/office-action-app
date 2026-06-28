import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactKind } from "@/lib/chat/events";
import type { Database, Json } from "@/lib/database.types";

/**
 * Step4+ の成果物の永続化ヘルパ（PRD §8 / §10 共通: ユーザープロンプトと LLM 出力を messages に、
 * 主要な構造化成果物を case_artifacts に保存）。
 *
 * route.ts のインライン保存（Step2-3）と同じ規則を関数化したもの。エラー時は和文 Error を throw し、
 * 呼び出し側（ステップ実行関数／ディスパッチャ）が error イベントへ変換する（route.ts の toUserMessage 同様）。
 * server-only（機密本文を扱う。ログに出さない＝ガードレール7）。supabase は RLS 有効の server クライアントを渡す。
 */

/** ユーザープロンプトを messages に保存（step_no = 当該ステップの依頼番号）。 */
export async function saveUserMessage(
  supabase: SupabaseClient<Database>,
  caseId: string,
  stepNo: number,
  content: string,
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    case_id: caseId,
    role: "user",
    step_no: stepNo,
    content,
  });
  if (error) throw new Error("メッセージの保存に失敗しました。");
}

/** LLM 出力を messages に保存（step_no = 当該ステップの出力番号）。 */
export async function saveAssistantMessage(
  supabase: SupabaseClient<Database>,
  caseId: string,
  stepNo: number,
  content: string,
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    case_id: caseId,
    role: "assistant",
    step_no: stepNo,
    content,
  });
  if (error) throw new Error("メッセージの保存に失敗しました。");
}

/** 構造化成果物を case_artifacts に保存（再開・再利用のため。PRD §8.1）。 */
export async function saveArtifact(
  supabase: SupabaseClient<Database>,
  caseId: string,
  kind: ArtifactKind,
  stepNo: number,
  payload: Json,
): Promise<void> {
  const { error } = await supabase.from("case_artifacts").insert({
    case_id: caseId,
    kind,
    step_no: stepNo,
    payload,
  });
  if (error) throw new Error("解析結果の保存に失敗しました。");
}

/** 案件の進捗ステップを更新（前進時のみ呼ぶ想定。route.ts の current_step 更新と同じ）。 */
export async function setCurrentStep(
  supabase: SupabaseClient<Database>,
  caseId: string,
  step: number,
): Promise<void> {
  const { error } = await supabase
    .from("cases")
    .update({ current_step: step })
    .eq("id", caseId);
  if (error) throw new Error("進捗の更新に失敗しました。");
}
