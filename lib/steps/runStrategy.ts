import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StepEvent } from "@/lib/chat/events";
import { getAnthropic } from "@/lib/anthropic/client";
import { modelForStep } from "@/lib/config/models";
import { buildCaseContext, type CaseContext } from "@/lib/context/buildContext";
import { S6_SYSTEM_PROMPT } from "@/lib/prompts/step6";
import { STRATEGY_SCHEMA, type StrategyResult } from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step6（応答方針）の実行コア（PRD §11-S6・最重要）。runValidity と同じ流儀:
 *  1. buildCaseContext で「保存済み全文テキスト＋会話履歴」を組む（原本 PDF は送らない＝§7.5）。
 *     結線後は履歴に Step4 妥当性評価が含まれるため、その弱点分析を踏まえた方針になる。
 *  2. modelForStep(6) のモデルに STRATEGY_SCHEMA の構造化出力（広狭 3 案以上）を求める。
 *  3. StepEvent（step_start → artifact → step_done）を yield しつつ、パース済み結果を return。
 *
 * 永続化はしない（副作用なし。保存は呼び出し側＝Track B のディスパッチャ or 検証スクリプト）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */

const STEP = 6 as const;
/** Step6 完了後の進捗（次は Step7 ＝ オートラン標準停止点・§7.10）。 */
const NEXT_STEP = 7 as const;

/** 自由入力が「次へ」程度でも応答方針を立案するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "Step4 の妥当性評価を踏まえ、拒絶理由を覆せる範囲で最も広いクレームを狙う応答方針（広狭の幅を持つ 3 案以上）を立ててください。";

/** stop_reason を検査し、失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("応答方針の立案が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて応答方針が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して StrategyResult に変換する。 */
function parseStrategy(raw: string | null): StrategyResult {
  if (!raw) {
    throw new Error("応答方針の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("応答方針の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("応答方針の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.strategies) ||
    typeof rec.recommendation !== "object" ||
    rec.recommendation === null ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("応答方針の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as StrategyResult;
}

/** Claude に応答方針を求めて構造化結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callStrategy(
  ctx: CaseContext,
  userMessage: string,
): Promise<StrategyResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  const userContent = `【検討対象の文書（保存済みテキスト）】\n\n${ctx.documentsBlock}\n\n---\n\n【依頼】\n${instruction}\n\n出力は指定された JSON スキーマに厳密に従ってください。`;

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP),
      max_tokens: 32000,
      system: S6_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: STRATEGY_SCHEMA } },
      messages: [...ctx.history, { role: "user", content: userContent }],
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseStrategy(raw);
}

/**
 * Step6 応答方針を実行する。StepEvent を逐次 yield し、最後にパース済み結果を返す。
 * 呼び出し側は `for await` でイベントをストリームへ流し、return 値（StrategyResult）を永続化に使う。
 */
export async function* runStrategy(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
): AsyncGenerator<StepEvent, StrategyResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  const result = await callStrategy(ctx, userMessage);

  yield { t: "artifact", step: STEP, kind: "strategies", payload: result };
  yield { t: "step_done", step: STEP, currentStep: NEXT_STEP };
  return result;
}
