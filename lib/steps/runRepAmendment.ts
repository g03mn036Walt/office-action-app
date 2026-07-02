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
import { S8_SYSTEM_PROMPT } from "@/lib/prompts/step8";
import {
  REP_AMENDMENT_SCHEMA,
  type RepAmendmentResult,
} from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step8（代表クレーム補正）の実行コア（PRD §11-S8・重要）。runValidity/runStrategy と同じ流儀:
 *  1. buildCaseContext で「保存済み全文テキスト＋会話履歴」を組む（原本 PDF は送らない＝§7.5）。
 *     履歴に Step6 応答方針が含まれるため、決定方針を踏まえた必要最小限の補正になる。
 *  2. modelForStep(8) のモデルに REP_AMENDMENT_SCHEMA の構造化出力（補正後クレームの segment 列）を求める。
 *  3. StepEvent（step_start → artifact → step_done）を yield しつつ、パース済み結果を return。
 *
 * 永続化はしない（副作用なし。保存は呼び出し側＝ディスパッチャ or 検証スクリプト）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */

const STEP = 8 as const;
/** Step8 完了後の進捗（次は Step9 ＝ 代表補正の表示・追問）。 */
const NEXT_STEP = 9 as const;

/** 自由入力が「次へ」程度でも代表補正案を作成するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "決定した応答方針に基づき、代表請求項について必要最小限の補正案（可能なら広狭の異なる 3 案）を作成してください。";

/** stop_reason を検査し、失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("補正案の作成が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて補正案が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して RepAmendmentResult に変換する。 */
function parseRepAmendment(raw: string | null): RepAmendmentResult {
  if (!raw) {
    throw new Error("補正案の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("補正案の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("補正案の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.options) ||
    typeof rec.recommendation !== "object" ||
    rec.recommendation === null ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("補正案の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as RepAmendmentResult;
}

/** Claude に代表補正案を求めて構造化結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callRepAmendment(
  ctx: CaseContext,
  userMessage: string,
  opts: StepCallOptions,
): Promise<RepAmendmentResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  const { system, messages } = buildStepInput(ctx, S8_SYSTEM_PROMPT, instruction, opts.cache ?? false);

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP, opts.model),
      max_tokens: 32000,
      system,
      output_config: {
        format: { type: "json_schema", schema: REP_AMENDMENT_SCHEMA },
      },
      messages,
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseRepAmendment(raw);
}

/**
 * Step8 代表クレーム補正を実行する。StepEvent を逐次 yield し、最後にパース済み結果を返す。
 * 呼び出し側は `for await` でイベントをストリームへ流し、return 値（RepAmendmentResult）を永続化に使う。
 */
export async function* runRepAmendment(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
  opts: StepCallOptions = {},
): AsyncGenerator<StepEvent, RepAmendmentResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  const result = await callRepAmendment(ctx, userMessage, opts);

  yield { t: "artifact", step: STEP, kind: "rep_amendment", payload: result };
  yield { t: "step_done", step: STEP, currentStep: NEXT_STEP };
  return result;
}
