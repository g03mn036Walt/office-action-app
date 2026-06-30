import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactKind, ChatEvent, StepEvent } from "@/lib/chat/events";
import { toUserMessage } from "@/lib/steps/errors";
import {
  saveArtifact,
  saveAssistantMessage,
  saveUserMessage,
  setCurrentStep,
} from "@/lib/steps/persist";
import { runFullAmendment } from "@/lib/steps/runFullAmendment";
import { runRepAmendment } from "@/lib/steps/runRepAmendment";
import { runStrategy } from "@/lib/steps/runStrategy";
import { runValidity } from "@/lib/steps/runValidity";
import type {
  FullAmendmentResult,
  RepAmendmentResult,
  StrategyResult,
  ValidityResult,
} from "@/lib/steps/schemas";
import type { Database, Json } from "@/lib/database.types";

/**
 * Step4+ の最小ディスパッチャ（PRD §10）。current_step から「次に実行する 1 ステップ」を決め、
 * 対応する実行コア（runValidity/runStrategy）を回してイベントを send で転送し、成果物を永続化する。
 *
 * ※ 本スライスは最小版: 自由入力の意図解釈（進む／現ステップ追問の判別）とオートラン（§7.10）は
 * 後続スライス。いまは「送信＝次の 1 ステップを実行」。実装済みは S4(妥当性)/S6(応答方針)/S8(代表補正)/
 * S10(全文補正)、S12 以降は順次追加。server-only（機密本文を扱う。ログに出さない＝ガードレール7）。
 */

/** どの実行パスへ振り分けるか（current_step 基準: <3=解析, →S4, →S6, →S8, →S10, それ以降=未実装）。 */
export function nextStepToRun(
  currentStep: number | null | undefined,
): "analysis" | 4 | 6 | 8 | 10 | "unsupported" {
  const cs = currentStep ?? 0;
  if (cs < 3) return "analysis";
  if (cs <= 4) return 4; // 解析済（3）→ 妥当性評価
  if (cs <= 6) return 6; // S4-5 済（5）→ 応答方針
  if (cs <= 8) return 8; // S6-7 済（7）→ 代表補正
  if (cs <= 10) return 10; // S8-9 済（9）→ 全文補正
  return "unsupported"; // 11+ : S12 以降は未実装
}

type SendFn = (ev: ChatEvent) => void;

/** 1 ステップの実行コアを回し、イベントを転送しつつ成果物を永続化する共通処理。 */
async function runStepAndPersist<R>(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  send: SendFn,
  opts: {
    /** ユーザー依頼・成果物の step_no（4 や 6）。 */
    stepNo: number;
    runner: (
      s: SupabaseClient<Database>,
      c: string,
      m: string,
    ) => AsyncGenerator<StepEvent, R, void>;
    kind: ArtifactKind;
    /** 構造化結果からチャット本文（messages.content）を組む。 */
    assistantText: (result: R) => string;
  },
): Promise<boolean> {
  try {
    await saveUserMessage(
      supabase,
      caseId,
      opts.stepNo,
      message.trim() || "（次のステップを実行）",
    );

    // 実行コアを回す: StepEvent はそのまま転送し、step_done から次ステップ番号を得る。
    const gen = opts.runner(supabase, caseId, message);
    let result: R | undefined;
    let nextStep = opts.stepNo + 1;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      send(value);
      if (value.t === "step_done") nextStep = value.currentStep;
    }
    if (result === undefined) {
      throw new Error("ステップ結果を取得できませんでした。");
    }

    // 成果物を保存（構造化＝case_artifacts、チャット本文＝messages、進捗＝current_step）。
    await saveArtifact(
      supabase,
      caseId,
      opts.kind,
      opts.stepNo,
      result as unknown as Json,
    );
    await saveAssistantMessage(
      supabase,
      caseId,
      nextStep,
      opts.assistantText(result),
    );
    await setCurrentStep(supabase, caseId, nextStep);
    return true;
  } catch (err) {
    send({ t: "error", step: opts.stepNo, message: toUserMessage(err) });
    return false;
  }
}

/** 指定ステップ（4=妥当性評価 / 6=応答方針 / 8=代表補正 / 10=全文補正）を実行する。 */
export async function runStep(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  step: 4 | 6 | 8 | 10,
  send: SendFn,
): Promise<boolean> {
  if (step === 4) {
    return runStepAndPersist<ValidityResult>(supabase, caseId, message, send, {
      stepNo: 4,
      runner: runValidity,
      kind: "validity",
      assistantText: (r) =>
        `妥当性評価を実施しました。\n\n${r.overall ?? ""}`.trim(),
    });
  }
  if (step === 6) {
    return runStepAndPersist<StrategyResult>(supabase, caseId, message, send, {
      stepNo: 6,
      runner: runStrategy,
      kind: "strategies",
      assistantText: (r) =>
        `応答方針を立案しました（推奨: ${r.recommendation?.recommended_label ?? "—"}）。\n\n${r.overall ?? ""}`.trim(),
    });
  }
  if (step === 8) {
    return runStepAndPersist<RepAmendmentResult>(supabase, caseId, message, send, {
      stepNo: 8,
      runner: runRepAmendment,
      kind: "rep_amendment",
      assistantText: (r) =>
        `代表クレームの補正案を作成しました（推奨: ${r.recommendation?.recommended_label ?? "—"}）。\n\n${r.overall ?? ""}`.trim(),
    });
  }
  return runStepAndPersist<FullAmendmentResult>(supabase, caseId, message, send, {
    stepNo: 10,
    runner: runFullAmendment,
    kind: "full_amendment",
    assistantText: (r) =>
      `全文補正案を作成しました。\n\n${r.summary_of_changes ?? ""}`.trim(),
  });
}
