import "server-only";

import { getAnthropic } from "@/lib/anthropic/client";
import { CLASSIFIER_MODEL } from "@/lib/config/models";
import { stepLabel } from "@/lib/config/steps";
import { INTENT_SYSTEM_PROMPT } from "@/lib/prompts/intent";
import { INTENT_SCHEMA, type IntentResult } from "@/lib/steps/schemas";

/**
 * 自由入力の意図分類（PRD §10 /「進む」判定・§7.10）。
 *
 * ユーザーの1メッセージ＋現在の進捗（current_step）から {mode, target_step, reason} を返す。
 * 実分析はせず軽量モデル（CLASSIFIER_MODEL）で分類のみ行う（route の分岐に使う）。
 * server-only（getAnthropic は機密。分類対象のメッセージ本文はログに出さない＝ガードレール7）。
 *
 * 失敗時・空入力時は安全側の既定（advance）にフォールバックし、送信をブロックしない。
 */

/** 分類できないときの安全な既定（次の1ステップを進める）。 */
const DEFAULT_INTENT: IntentResult = {
  mode: "advance",
  target_step: 7,
  reason: "既定（分類なし）",
};

function parseIntent(raw: string | null): IntentResult {
  if (!raw) return DEFAULT_INTENT;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return DEFAULT_INTENT;
  }
  if (typeof obj !== "object" || obj === null) return DEFAULT_INTENT;
  const rec = obj as Record<string, unknown>;
  const mode = rec.mode;
  if (
    mode !== "advance" &&
    mode !== "autorun" &&
    mode !== "followup" &&
    mode !== "ambiguous"
  ) {
    return DEFAULT_INTENT;
  }
  const target =
    typeof rec.target_step === "number" ? rec.target_step : 7;
  const reason = typeof rec.reason === "string" ? rec.reason : "";
  return { mode, target_step: target, reason };
}

/**
 * 自由入力の意図を分類する。空入力は分類せず advance（送信＝次を実行）にする。
 * 分類自体が失敗しても throw せず advance を返す（機能をブロックしない）。
 */
export async function classifyIntent(
  message: string,
  currentStep: number,
): Promise<IntentResult> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { mode: "advance", target_step: 7, reason: "空入力＝前進" };
  }

  const userContent = `現在の進捗: current_step=${currentStep}（${stepLabel(currentStep) || "—"}）。\nユーザー入力: 「${trimmed}」\nこの入力の意図を分類してください。`;

  try {
    const final = await getAnthropic()
      .beta.messages.stream({
        model: CLASSIFIER_MODEL,
        max_tokens: 1024,
        system: INTENT_SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: INTENT_SCHEMA } },
        messages: [{ role: "user", content: userContent }],
      })
      .finalMessage();

    if (final.stop_reason === "refusal") return DEFAULT_INTENT;
    const block = final.content.find((b) => b.type === "text");
    const rawText = block && block.type === "text" ? block.text : null;
    return parseIntent(rawText);
  } catch {
    // 分類の失敗で送信をブロックしない（安全側の advance）。
    return DEFAULT_INTENT;
  }
}
