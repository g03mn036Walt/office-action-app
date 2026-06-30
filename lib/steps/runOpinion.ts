import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StepEvent } from "@/lib/chat/events";
import { getAnthropic } from "@/lib/anthropic/client";
import { modelForStep } from "@/lib/config/models";
import { buildCaseContext, type CaseContext } from "@/lib/context/buildContext";
import { S12_SYSTEM_PROMPT } from "@/lib/prompts/step12";
import { OPINION_SCHEMA, type OpinionResult } from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step12（意見書）の実行コア（PRD §11-S12）。runRepAmendment/runFullAmendment と同じ流儀:
 *  1. buildCaseContext で「保存済み全文テキスト＋会話履歴」を組む（原本 PDF は送らない＝§7.5）。
 *     履歴に Step10 全文補正案が含まれるため、それに基づく反論になる。
 *  2. modelForStep(12) のモデルに OPINION_SCHEMA の構造化出力（拒絶理由ごとの反論）を求める。
 *  3. StepEvent（step_start → artifact → step_done）を yield しつつ、パース済み結果を return。
 *
 * 永続化はしない（副作用なし。保存は呼び出し側＝ディスパッチャ or 検証スクリプト）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */

const STEP = 12 as const;
/** Step12 完了後の進捗（次は Step13 ＝ 意見書の表示・追問）。 */
const NEXT_STEP = 13 as const;

/** 自由入力が「次へ」程度でも意見書案を作成するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "決定した全文補正案に基づき、全ての拒絶理由に対応する意見書案を作成してください（明細書記載を主体に、エストッペルに配慮）。";

/** stop_reason を検査し、失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("意見書案の作成が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて意見書案が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して OpinionResult に変換する。 */
function parseOpinion(raw: string | null): OpinionResult {
  if (!raw) {
    throw new Error("意見書案の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("意見書案の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("意見書案の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.arguments) ||
    typeof rec.introduction !== "string" ||
    typeof rec.conclusion !== "string" ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("意見書案の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as OpinionResult;
}

/** Claude に意見書案を求めて構造化結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callOpinion(
  ctx: CaseContext,
  userMessage: string,
): Promise<OpinionResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  const userContent = `【検討対象の文書（保存済みテキスト）】\n\n${ctx.documentsBlock}\n\n---\n\n【依頼】\n${instruction}\n\n出力は指定された JSON スキーマに厳密に従ってください。`;

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP),
      max_tokens: 32000,
      system: S12_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: OPINION_SCHEMA } },
      messages: [...ctx.history, { role: "user", content: userContent }],
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseOpinion(raw);
}

/**
 * Step12 意見書を実行する。StepEvent を逐次 yield し、最後にパース済み結果を返す。
 * 呼び出し側は `for await` でイベントをストリームへ流し、return 値（OpinionResult）を永続化に使う。
 */
export async function* runOpinion(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
): AsyncGenerator<StepEvent, OpinionResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  const result = await callOpinion(ctx, userMessage);

  yield { t: "artifact", step: STEP, kind: "opinion", payload: result };
  yield { t: "step_done", step: STEP, currentStep: NEXT_STEP };
  return result;
}
