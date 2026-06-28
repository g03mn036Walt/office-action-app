/**
 * チャットの NDJSON イベント契約（クライアント・サーバー共有の「単一の正」）。
 *
 * サーバー（route / ステップ実行関数）は 1 イベント = JSON 1 行（`JSON.stringify(ev) + "\n"`）で
 * 送信し、クライアント（components/app/Chat.tsx）は行ごとに parse してこの union として扱う。
 * server-only にしない（Chat.tsx＝クライアントからも import するため）。
 *
 * Step2-3（解析）の文書単位イベント（DocEvent）は既存実装（app/api/chat/route.ts）の形を温存し、
 * Phase 2 の Step4+ 用にステップ単位イベント（StepEvent）を追加する。Step4+ は 1 ステップ＝1 つの
 * アシスタントメッセージのストリーム（text_delta）＋構造化成果物（artifact）として表現する。
 */

/** 構造化成果物の種別。case_files/case_artifacts の kind 語彙（PRD §8.1）と一致させる。 */
export type ArtifactKind =
  | "summary"
  | "validity"
  | "strategies"
  | "rep_amendment"
  | "full_amendment"
  | "opinion"
  | "docx";

/** Step2-3（解析）の文書単位イベント（既存・温存）。 */
export type DocEvent =
  | { t: "doc_start"; fileName: string; role: string }
  | { t: "summary"; fileName: string; text: string }
  | { t: "doc_done"; fileName: string }
  /** 中立の案内（エラーではない。2b: 全文テキスト化は完了したが要約を再送に先送り）。 */
  | { t: "info"; fileName: string; message: string };

/** Step4+ のステップ単位イベント（新規）。 */
export type StepEvent =
  /** ステップ開始（UI が「Step N を実行中」を表示）。 */
  | { t: "step_start"; step: number }
  /** アシスタント本文の逐次チャンク（ストリーミング表示）。 */
  | { t: "text_delta"; step: number; text: string }
  /** 構造化成果物（妥当性チャート／方針案／補正案／docx リンク等）。payload は kind で絞る。 */
  | { t: "artifact"; step: number; kind: ArtifactKind; payload: unknown }
  /** ステップ完了＆永続化済み。UI は currentStep で進捗表示を更新する。 */
  | { t: "step_done"; step: number; currentStep: number }
  /** オートランで次ステップへ進む（§7.10）。 */
  | { t: "autorun_advance"; from: number; to: number };

/** 文書単位／ステップ単位の双方で使う共通の終端・エラー。 */
export type CommonEvent =
  /** エラー（文書単位なら fileName、ステップ単位なら step を伴う）。 */
  | { t: "error"; fileName?: string; step?: number; message: string }
  /** 終端。ok===false は一部失敗（再送で残りを進める）、それ以外は成功。 */
  | { t: "done"; ok?: boolean };

/** チャットストリームで流れる全イベント。 */
export type ChatEvent = DocEvent | StepEvent | CommonEvent;
