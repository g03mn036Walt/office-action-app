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
import { S14_SYSTEM_PROMPT } from "@/lib/prompts/step14";
import { DOCX_SCHEMA, type DocxResult } from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * Step14（書面出力）の実行コア（PRD §11-S14 / §7.7）。
 *
 * 他ステップと同じく LLM 呼び出しのみで**副作用なし**: Claude に補正書・意見書・見解書の構造化テキスト
 * （DocxResult）を出させて return する。実ファイル(.docx)生成・Storage 保存・署名 URL・永続化は
 * 呼び出し側（dispatch の runDocxAndPersist）が担う（生成物が必要な docx artifact は dispatch が emit する）。
 *
 * このため本関数が yield するのは step_start のみ（artifact/step_done は dispatch 側で生成物確定後に送る）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */

const STEP = 14 as const;

/** 自由入力が「次へ」程度でも書面を作成するためのデフォルト依頼文。 */
const DEFAULT_INSTRUCTION =
  "これまでの検討に基づき、補正書・意見書・見解書の構造化テキストを作成してください。";

/** stop_reason を検査し、失敗を黙って通さない（route.ts の guardStop と同流儀）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("書面の作成が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("出力が長すぎて書面が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して DocxResult に変換する。 */
function parseDocx(raw: string | null): DocxResult {
  if (!raw) {
    throw new Error("書面の結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("書面の結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("書面の結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  if (
    !Array.isArray(rec.documents) ||
    rec.documents.length === 0 ||
    typeof rec.overall !== "string"
  ) {
    throw new Error("書面の結果の形式が不正です。");
  }
  // 細部の型は output_config(strict schema) が保証する。ここでは大枠のみ検証して受け取る。
  return rec as unknown as DocxResult;
}

/** Claude に書面の構造化テキストを求めて結果を得る（履歴 + 全文テキスト + 当該依頼）。 */
async function callDocx(
  ctx: CaseContext,
  userMessage: string,
  opts: StepCallOptions,
): Promise<DocxResult> {
  const instruction = userMessage.trim() || DEFAULT_INSTRUCTION;
  const { system, messages } = buildStepInput(ctx, S14_SYSTEM_PROMPT, instruction, opts.cache ?? false);

  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(STEP, opts.model),
      max_tokens: 32000,
      system,
      output_config: { format: { type: "json_schema", schema: DOCX_SCHEMA } },
      messages,
    })
    .finalMessage();

  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  return parseDocx(raw);
}

/**
 * Step14 書面出力の構造化テキストを生成する。step_start を yield し、最後に DocxResult を返す。
 * artifact（DL リンク付き）と step_done は dispatch の runDocxAndPersist が生成物確定後に送る。
 */
export async function* runDocx(
  supabase: SupabaseClient<Database>,
  caseId: string,
  userMessage: string,
  opts: StepCallOptions = {},
): AsyncGenerator<StepEvent, DocxResult, void> {
  yield { t: "step_start", step: STEP };

  const ctx = await buildCaseContext(supabase, caseId);
  if (ctx.documentCount === 0) {
    throw new Error(
      "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
    );
  }

  return await callDocx(ctx, userMessage, opts);
}
