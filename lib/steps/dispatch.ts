import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactKind, ChatEvent, StepEvent } from "@/lib/chat/events";
import { CASE_FILES_BUCKET } from "@/lib/config/storage";
import { buildDocxFiles } from "@/lib/docx/build";
import { toUserMessage } from "@/lib/steps/errors";
import {
  saveArtifact,
  saveAssistantMessage,
  saveUserMessage,
  setCurrentStep,
} from "@/lib/steps/persist";
import { runDocx } from "@/lib/steps/runDocx";
import { runFullAmendment } from "@/lib/steps/runFullAmendment";
import { runOpinion } from "@/lib/steps/runOpinion";
import { runRepAmendment } from "@/lib/steps/runRepAmendment";
import { runStrategy } from "@/lib/steps/runStrategy";
import { runValidity } from "@/lib/steps/runValidity";
import type {
  DocxDeliverResult,
  DocxDownloadDocument,
  DocxResult,
  FullAmendmentResult,
  OpinionResult,
  RepAmendmentResult,
  StrategyResult,
  ValidityResult,
} from "@/lib/steps/schemas";
import type { Database, Json } from "@/lib/database.types";

/** 生成 Word の MIME（Storage 保存時の contentType）。 */
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Step4+ の最小ディスパッチャ（PRD §10）。current_step から「次に実行する 1 ステップ」を決め、
 * 対応する実行コア（runValidity/runStrategy）を回してイベントを send で転送し、成果物を永続化する。
 *
 * ※ 本スライスは最小版: 自由入力の意図解釈（進む／現ステップ追問の判別）とオートラン（§7.10）は
 * 後続スライス。いまは「送信＝次の 1 ステップを実行」。S4(妥当性)/S6(応答方針)/S8(代表補正)/
 * S10(全文補正)/S12(意見書)/S14(書面出力) を実装済み。server-only（機密本文を扱う。ログに出さない＝ガードレール7）。
 */

/** どの実行パスへ振り分けるか（current_step 基準: <3=解析, →S4, →S6, →S8, →S10, →S12, →S14, 完了後=未実装）。 */
export function nextStepToRun(
  currentStep: number | null | undefined,
): "analysis" | 4 | 6 | 8 | 10 | 12 | 14 | "unsupported" {
  const cs = currentStep ?? 0;
  if (cs < 3) return "analysis";
  if (cs <= 4) return 4; // 解析済（3）→ 妥当性評価
  if (cs <= 6) return 6; // S4-5 済（5）→ 応答方針
  if (cs <= 8) return 8; // S6-7 済（7）→ 代表補正
  if (cs <= 10) return 10; // S8-9 済（9）→ 全文補正
  if (cs <= 12) return 12; // S10-11 済（11）→ 意見書
  if (cs <= 14) return 14; // S12-13 済（13）→ 書面出力
  return "unsupported"; // 15+ : 検討フロー完了
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

/**
 * 指定ステップを実行する（4=妥当性評価 / 6=応答方針 / 8=代表補正 / 10=全文補正 / 12=意見書 / 14=書面出力）。
 * S14 のみ Storage 保存・署名 URL が絡むため専用の runDocxAndPersist を呼ぶ。
 */
export async function runStep(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  step: 4 | 6 | 8 | 10 | 12 | 14,
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
  if (step === 10) {
    return runStepAndPersist<FullAmendmentResult>(supabase, caseId, message, send, {
      stepNo: 10,
      runner: runFullAmendment,
      kind: "full_amendment",
      assistantText: (r) =>
        `全文補正案を作成しました。\n\n${r.summary_of_changes ?? ""}`.trim(),
    });
  }
  if (step === 12) {
    return runStepAndPersist<OpinionResult>(supabase, caseId, message, send, {
      stepNo: 12,
      runner: runOpinion,
      kind: "opinion",
      assistantText: (r) =>
        `意見書案を作成しました。\n\n${r.overall ?? ""}`.trim(),
    });
  }
  return runDocxAndPersist(supabase, caseId, message, send);
}

/**
 * Step14（書面出力）専用の実行＋永続化（PRD §11-S14 / §7.7）。
 *
 * runStepAndPersist と違い、LLM の構造化テキスト（DocxResult）から .docx を生成して Storage に保存し、
 * 署名 URL を付与した artifact を送る。生成物が揃ってから artifact → step_done の順で送り、兄弟ステップと
 * 同じ start → artifact → done の体感にする。永続化する payload は失効する署名 URL を除き storage_path
 * のみ残す（再読込時は案件ページが lib/docx/deliver.ts で署名 URL を再発行する）。server-only（機密本文をログに出さない＝ガードレール7）。
 */
async function runDocxAndPersist(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  send: SendFn,
): Promise<boolean> {
  const STEP_NO = 14;
  const NEXT_STEP = 15;
  try {
    await saveUserMessage(
      supabase,
      caseId,
      STEP_NO,
      message.trim() || "（次のステップを実行）",
    );

    // runDocx は step_start を yield し DocxResult を返す（artifact/step_done は生成物確定後に本関数が送る）。
    const gen = runDocx(supabase, caseId, message);
    let result: DocxResult | undefined;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      send(value); // step_start
    }
    if (result === undefined) {
      throw new Error("ステップ結果を取得できませんでした。");
    }

    // Storage パスの先頭フォルダ = user_id（RLS と一致させる）。
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("認証が必要です。再度ログインしてください。");
    }

    // 構造化テキスト → .docx Buffer（純関数。files は result.documents と同順）。
    const files = await buildDocxFiles(result);
    const srcDocs = result.documents ?? [];

    const documents: DocxDownloadDocument[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const src = srcDocs[i];
      if (!src) continue;
      const storagePath = `${user.id}/${caseId}/generated/${randomUUID()}-${file.docKind}.docx`;
      const { error: uploadError } = await supabase.storage
        .from(CASE_FILES_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: DOCX_CONTENT_TYPE,
          upsert: false,
        });
      if (uploadError) {
        throw new Error("書面ファイルの保存に失敗しました。");
      }
      const { data: signed } = await supabase.storage
        .from(CASE_FILES_BUCKET)
        // download=ファイル名で Content-Disposition: attachment を強制（署名 URL は別オリジンのため
        // HTML の download 属性が効かない。日本語ファイル名で確実に DL させる）。
        .createSignedUrl(storagePath, 3600, { download: file.fileName });
      documents.push({
        ...src,
        storage_path: storagePath,
        download_url: signed?.signedUrl ?? "",
      });
    }

    const deliver: DocxDeliverResult = {
      country: result.country,
      documents,
      overall: result.overall,
    };

    // 生成物が揃ってから artifact（DL リンク付き）→ step_done の順で送る。
    send({ t: "artifact", step: STEP_NO, kind: "docx", payload: deliver });
    send({ t: "step_done", step: STEP_NO, currentStep: NEXT_STEP });

    // 永続化: 失効する署名 URL を除いた payload（storage_path のみ）を保存する。
    const persisted: DocxDeliverResult = {
      country: deliver.country,
      overall: deliver.overall,
      documents: documents.map((d) => ({ ...d, download_url: "" })),
    };
    await saveArtifact(
      supabase,
      caseId,
      "docx",
      STEP_NO,
      persisted as unknown as Json,
    );
    await saveAssistantMessage(
      supabase,
      caseId,
      NEXT_STEP,
      `補正書・意見書・見解書を生成しました。各書面はダウンロードリンクから取得できます。\n\n${result.overall ?? ""}`.trim(),
    );
    await setCurrentStep(supabase, caseId, NEXT_STEP);
    return true;
  } catch (err) {
    send({ t: "error", step: STEP_NO, message: toUserMessage(err) });
    return false;
  }
}
