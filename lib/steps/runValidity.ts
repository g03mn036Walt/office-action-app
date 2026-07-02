import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StepEvent } from "@/lib/chat/events";
import { getAnthropic } from "@/lib/anthropic/client";
import { modelForStep, type StepCallOptions } from "@/lib/config/models";
import {
  buildCaseContext,
  buildStepInput,
  type CaseContext,
} from "@/lib/context/buildContext";
import { S4_SYSTEM_PROMPT } from "@/lib/prompts/step4";
import { VALIDITY_SCHEMA, type ValidityResult } from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step4-S5（妥当性評価）の実行コア（PRD §11-S4）。
 *
 * route.ts には依存しない純粋なステップ実行関数（Track A）。やることは 3 つ:
 *  1. buildCaseContext で「保存済み全文テキスト＋会話履歴」を組む（原本 PDF は送らない＝コスト方針 §7.5）。
 *  2. modelForStep(4) のモデルに VALIDITY_SCHEMA の構造化出力を求める（route.ts の analyze* と同じ流儀:
 *     beta.messages.stream(...).finalMessage() で大きい出力に耐える）。
 *  3. 進捗を StepEvent（step_start → artifact → step_done）として yield しつつ、パース済み結果を return する。
 *
 * 永続化（messages / case_artifacts / current_step）は行わない。呼び出し側（Track B のディスパッチャ、
 * もしくは検証スクリプト）が yield されたイベントを見て persist.ts のヘルパで保存する。これにより本関数は
 * 副作用を持たず、scratchpad から実 API 1 回で検証できる（DB を汚さない）。
 *
 * server-only（getAnthropic / extracted_text は機密。ログに本文を出さない＝ガードレール7）。
 * supabase は RLS 有効の server クライアント／service_role の admin クライアントどちらでも可。
 * エラーは和文 Error を throw し、呼び出し側が error イベントへ変換する（route.ts の toUserMessage 同様）。
 */

const STEP = 4 as const;
/** Step4 完了後の進捗（次は Step5）。永続化の有無に関わらず UI 進捗の目安として step_done に載せる。 */
const NEXT_STEP = 5 as const;

/** 自由入力が「次へ」程度でも妥当性評価を実施するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "現クレームと OA について、Step4 の妥当性評価を実施してください。";

/** stop_reason を検査し、解析失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("妥当性評価が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて妥当性評価が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して ValidityResult に変換する。 */
function parseValidity(raw: string | null): ValidityResult {
  if (!raw) {
    throw new Error("妥当性評価の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("妥当性評価の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("妥当性評価の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.claims) ||
    !Array.isArray(rec.rejections) ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("妥当性評価の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as ValidityResult;
}

/** Claude に妥当性評価を求めて構造化結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callValidity(
  ctx: CaseContext,
  userMessage: string,
  opts: StepCallOptions,
): Promise<ValidityResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  // 全文書＋依頼を組む。cache=true（オートラン継続）時は文書をキャッシュ可能な system に置く（§7.5）。
  const { system, messages } = buildStepInput(
    ctx,
    S4_SYSTEM_PROMPT,
    instruction,
    opts.cache ?? false,
  );

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP, opts.model),
      max_tokens: 32000,
      system,
      output_config: { format: { type: "json_schema", schema: VALIDITY_SCHEMA } },
      messages,
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseValidity(raw);
}

/**
 * Step4 妥当性評価を実行する。StepEvent を逐次 yield し、最後にパース済み結果を返す。
 * 呼び出し側は `for await` でイベントをストリームへ流し、return 値（ValidityResult）を永続化に使う。
 */
export async function* runValidity(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
  opts: StepCallOptions = {},
): AsyncGenerator<StepEvent, ValidityResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  const result = await callValidity(ctx, userMessage, opts);

  yield { t: "artifact", step: STEP, kind: "validity", payload: result };
  yield { t: "step_done", step: STEP, currentStep: NEXT_STEP };
  return result;
}
