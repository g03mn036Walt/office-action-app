import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StepEvent } from "@/lib/chat/events";
import { getAnthropic } from "@/lib/anthropic/client";
import { modelForStep } from "@/lib/config/models";
import { buildCaseContext, type CaseContext } from "@/lib/context/buildContext";
import { S10_SYSTEM_PROMPT } from "@/lib/prompts/step10";
import {
  FULL_AMENDMENT_SCHEMA,
  type FullAmendmentResult,
} from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step10（全文クレーム補正）の実行コア（PRD §11-S10）。runRepAmendment と同じ流儀:
 *  1. buildCaseContext で「保存済み全文テキスト＋会話履歴」を組む（原本 PDF は送らない＝§7.5）。
 *     履歴に Step8 代表補正案が含まれるため、その方針を全クレームへ一貫適用する。
 *  2. modelForStep(10) のモデルに FULL_AMENDMENT_SCHEMA の構造化出力（全クレームの segment 列）を求める。
 *  3. StepEvent（step_start → artifact → step_done）を yield しつつ、パース済み結果を return。
 *
 * 永続化はしない（副作用なし。保存は呼び出し側＝ディスパッチャ or 検証スクリプト）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */

const STEP = 10 as const;
/** Step10 完了後の進捗（次は Step11 ＝ 全文補正の表示・追問）。 */
const NEXT_STEP = 11 as const;

/** 自由入力が「次へ」程度でも全文補正案を作成するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "決定した代表補正案に基づき、全クレームの全文補正案を作成してください（必要最小限の補正に徹し、全請求項を含める）。";

/** stop_reason を検査し、失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("全文補正案の作成が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて全文補正案が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して FullAmendmentResult に変換する。 */
function parseFullAmendment(raw: string | null): FullAmendmentResult {
  if (!raw) {
    throw new Error("全文補正案の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("全文補正案の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("全文補正案の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.claims) ||
    typeof rec.summary_of_changes !== "string" ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("全文補正案の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as FullAmendmentResult;
}

/** Claude に全文補正案を求めて構造化結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callFullAmendment(
  ctx: CaseContext,
  userMessage: string,
): Promise<FullAmendmentResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  const userContent = `【検討対象の文書（保存済みテキスト）】\n\n${ctx.documentsBlock}\n\n---\n\n【依頼】\n${instruction}\n\n出力は指定された JSON スキーマに厳密に従ってください。`;

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP),
      max_tokens: 32000,
      system: S10_SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: FULL_AMENDMENT_SCHEMA },
      },
      messages: [...ctx.history, { role: "user", content: userContent }],
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseFullAmendment(raw);
}

/**
 * Step10 全文クレーム補正を実行する。StepEvent を逐次 yield し、最後にパース済み結果を返す。
 * 呼び出し側は `for await` でイベントをストリームへ流し、return 値（FullAmendmentResult）を永続化に使う。
 */
export async function* runFullAmendment(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
): AsyncGenerator<StepEvent, FullAmendmentResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  const result = await callFullAmendment(ctx, userMessage);

  yield { t: "artifact", step: STEP, kind: "full_amendment", payload: result };
  yield { t: "step_done", step: STEP, currentStep: NEXT_STEP };
  return result;
}
