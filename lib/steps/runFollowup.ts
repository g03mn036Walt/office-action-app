import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatEvent } from "@/lib/chat/events";
import { getAnthropic } from "@/lib/anthropic/client";
import {
  modelForStep,
  type ModelPref,
  type StepNo,
} from "@/lib/config/models";
import { buildCaseContext } from "@/lib/context/buildContext";
import { FOLLOWUP_SYSTEM_PROMPT } from "@/lib/prompts/followup";
import { toUserMessage } from "@/lib/steps/errors";
import {
  saveAssistantMessage,
  saveUserMessage,
} from "@/lib/steps/persist";
import type { Database } from "@/lib/database.types";

/**
 * 追問（現ステップへの質問・修正依頼）を実行する（PRD §10）。ステップは進めない。
 *
 * buildCaseContext で「保存済み全文テキスト＋会話履歴」を組み、自由文の回答をストリーミング（text_delta）で返す。
 * user/assistant を **現ステップ番号で保存**し、artifact も current_step 更新もしない（進捗は変えない）。
 * 永続化とストリームへの送信を自己完結で行い、成否を boolean で返す（route の分岐から呼ぶ）。
 * server-only（getAnthropic / extracted_text は機密。本文をログに出さない＝ガードレール7）。
 */
export async function runFollowup(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  currentStep: number,
  send: (ev: ChatEvent) => void,
  modelPref?: ModelPref,
): Promise<boolean> {
  try {
    await saveUserMessage(supabase, caseId, currentStep, message.trim());

    const ctx = await buildCaseContext(supabase, caseId);
    if (ctx.documentCount === 0) {
      throw new Error(
        "解析済みの文書がありません。先に文書をアップロードして解析（Step2-3）を完了してください。",
      );
    }

    const userContent = `【検討対象の文書（保存済みテキスト）】\n\n${ctx.documentsBlock}\n\n---\n\n【質問・依頼】\n${message.trim()}`;

    // 進捗は変えないので、モデルは現ステップ相当のものを使う（UI ピッカーの選択があれば優先）。
    const model = modelForStep(
      Math.min(Math.max(currentStep, 1), 14) as StepNo,
      modelPref,
    );

    const stream = getAnthropic().messages.stream({
      model,
      max_tokens: 8000,
      system: FOLLOWUP_SYSTEM_PROMPT,
      messages: [...ctx.history, { role: "user", content: userContent }],
    });

    let full = "";
    stream.on("text", (delta) => {
      full += delta;
      send({ t: "text_delta", step: currentStep, text: delta });
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      throw new Error("回答が拒否されました。内容をご確認ください。");
    }

    await saveAssistantMessage(supabase, caseId, currentStep, full.trim());
    // 追問はステップを進めない（current_step は据え置き）。UI 完了合図として step_done を同ステップで送る。
    send({ t: "step_done", step: currentStep, currentStep });
    return true;
  } catch (err) {
    send({ t: "error", step: currentStep, message: toUserMessage(err) });
    return false;
  }
}

/** 意図が不明（ambiguous）なときに短い確認を返す（PRD §10「迷う場合は短く確認」）。ステップは進めない。 */
const CLARIFICATION_TEXT =
  "ご指示の意図を掴みかねました。次のいずれかで教えてください。\n・「次へ」…次の1ステップだけ進めます\n・「方針案まで一気に」など…指定した段階まで連続実行します\n・現在の内容への質問・修正…その場でお答えします（進みません）";

/**
 * ambiguous 時の確認応答（LLM を使わない固定文）。user/assistant を現ステップで保存し、
 * ストリームにも流す。ステップは進めない。route の分岐から呼ぶ。
 */
export async function runClarification(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  currentStep: number,
  send: (ev: ChatEvent) => void,
): Promise<boolean> {
  try {
    await saveUserMessage(
      supabase,
      caseId,
      currentStep,
      message.trim() || "（送信）",
    );
    send({ t: "text_delta", step: currentStep, text: CLARIFICATION_TEXT });
    await saveAssistantMessage(supabase, caseId, currentStep, CLARIFICATION_TEXT);
    send({ t: "step_done", step: currentStep, currentStep });
    return true;
  } catch (err) {
    send({ t: "error", step: currentStep, message: toUserMessage(err) });
    return false;
  }
}
