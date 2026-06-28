import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAnthropic } from "@/lib/anthropic/client";
import { transcribePdfByPages } from "@/lib/anthropic/visionPdf";
import { DOC_ROLES, labelForRole, type DocRole } from "@/lib/config/docRoles";
import { modelForStep } from "@/lib/config/models";
import { CASE_FILES_BUCKET } from "@/lib/config/storage";
import { extractPdfText } from "@/lib/extract/pdfText";
import { S2_SYSTEM_PROMPT } from "@/lib/prompts/step2";
import { toUserMessage } from "@/lib/steps/errors";
import type { Database } from "@/lib/database.types";

/**
 * Step2-3（解析・全文テキスト化・要約）の実行コア（Slice 3 / 2b の route.ts インライン実装を抽出）。
 *
 * 旧 route.ts の POST 内 ReadableStream 本体をそのまま関数化したもの（挙動不変）。POST 側は薄い
 * ストリームシェル（send/finish）に専念し、本関数は doc 単位イベント（doc_start/summary/doc_done/info/error）
 * を `send` で逐次出し、全文書の summary が揃った初回のみ messages 保存＋current_step=3 を行い、
 * 完了可否を boolean（ok）で返す（呼び出し側が done を送って close する）。
 *
 * 冪等化（summary 済みは再解析しない）・テキスト層抽出優先（PDF を Claude に送らない＝§7.5）・
 * 大部スキャンの 1頁分割並列転写＋要約ソフト締切（maxDuration=60s の無言 kill 回避）は 2b 実装のまま。
 * server-only（extracted_text/summary はログに出さない＝ガードレール7）。supabase は RLS 有効の server
 * クライアント（POST 経由）を渡す。
 */

/**
 * 要約を同一リクエストに入れるかのソフト締切。経過がこれ未満なら inline で要約、超なら再送に先送りする。
 * 大部スキャンの 1頁分割転写は ~46s を使うため、その場合は要約（~20s）を再送1回に回して maxDuration=60s の
 * 無言 kill を避ける（小さいスキャンは inline で1回完了。docs/slice3-step2-plan.md §2b）。
 */
const SUMMARY_DEADLINE_MS = 35_000;

/** 構造化出力スキーマ（object は additionalProperties:false + required 必須）。 */
const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string" },
  },
};

/** stop_reason を検査し、解析失敗を黙って通さない（refusal / max_tokens は和文エラーに）。 */
function guardStop(stop: string | null): void {
  if (stop === "refusal") {
    throw new Error("解析が拒否されました。文書の内容をご確認ください。");
  }
  if (stop === "max_tokens") {
    throw new Error("文書が長すぎて解析が途中で打ち切られました。");
  }
}

/** 構造化出力の JSON 文字列を検証して取り出す。full_text 必須かは呼び出し側で指定。 */
function parseAnalysis(
  raw: string | null,
  needFullText: boolean,
): { summary: string; full_text?: string } {
  if (!raw) {
    throw new Error("解析結果を取得できませんでした。");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("解析結果の形式が不正です。");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("解析結果の形式が不正です。");
  }
  const rec = obj as Record<string, unknown>;
  const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
  if (!summary) {
    throw new Error("概要を取得できませんでした。");
  }
  if (needFullText) {
    const full = typeof rec.full_text === "string" ? rec.full_text : "";
    if (!full.trim()) {
      throw new Error("全文テキストを取得できませんでした。");
    }
    return { summary, full_text: full };
  }
  return { summary };
}

/** 非PDF（抽出済みテキスト）から概要のみ。全文は既存 extracted_text を保持する。 */
async function analyzeNonPdf(
  role: DocRole,
  fileName: string,
  extractedText: string,
): Promise<{ summary: string }> {
  const final = await getAnthropic().messages.create({
    model: modelForStep(2),
    max_tokens: 4000,
    system: S2_SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `次は「${labelForRole(role)}: ${fileName}」の全文テキストです。内容概要(summary)のみを日本語で出力してください。\n\n---\n${extractedText}`,
      },
    ],
  });
  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  const parsed = parseAnalysis(raw, false);
  return { summary: parsed.summary };
}

/**
 * Step2-3 解析を実行する。doc 単位イベントを `send` で逐次出し、完了可否（全文書の summary が揃ったか）を返す。
 * done の送出と controller.close は呼び出し側（POST のストリームシェル）が行う。
 */
export async function runAnalysis(
  supabase: SupabaseClient<Database>,
  caseId: string,
  message: string,
  send: (obj: unknown) => void,
): Promise<boolean> {
  // maxDuration=60s に対する経過計測（大部スキャンの要約を再送へ先送りするソフト締切に使う）。
  const startedAt = Date.now();
  try {
    // 解析に必要な列のみ取得（DOC_ROLES 順 → role 内は created_at 昇順に並べ替え）。
    const { data: files, error: filesError } = await supabase
      .from("case_files")
      .select(
        "id, doc_role, file_name, anthropic_file_id, storage_path, extracted_text, summary, created_at",
      )
      .eq("case_id", caseId);
    if (filesError) {
      send({ t: "error", message: "文書の読み込みに失敗しました。" });
      return false;
    }

    const roleOrder = new Map(DOC_ROLES.map((m, i) => [m.role, i] as const));
    const orderedFiles = (files ?? []).slice().sort((a, b) => {
      const ra = roleOrder.get(a.doc_role as DocRole) ?? 99;
      const rb = roleOrder.get(b.doc_role as DocRole) ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

    if (orderedFiles.length === 0) {
      send({
        t: "error",
        message:
          "解析する文書がありません。先にファイルをアップロードしてください。",
      });
      return false;
    }

    // 冪等化: summary が既にある文書は再解析しない（既存 summary を流用）。
    const hasSummary = (f: (typeof orderedFiles)[number]) =>
      typeof f.summary === "string" && f.summary.trim().length > 0;
    const toAnalyze = orderedFiles.filter((f) => !hasSummary(f));

    // 今回新たに解析できた文書の summary（file id -> summary）。
    const analyzed = new Map<string, string>();

    // 対象全件をまず doc_start（UI が並行で「読み込み中」を表示）。
    for (const f of toAnalyze) {
      send({ t: "doc_start", fileName: f.file_name, role: f.doc_role });
    }

    // 並列解析。各タスクは自分でエラーを send し、成功時に summary/doc_done を send。
    // controller.enqueue は JS シングルスレッドで逐次実行されるため send 競合はない。
    await Promise.allSettled(
      toAnalyze.map(async (f) => {
        try {
          let summary: string;
          if (f.extracted_text) {
            // 既に抽出済み（非PDF、またはテキスト層抽出済みで summary だけ未生成）→ summary のみ。
            // 【冪等・再 download 不要。PDF も抽出後はここに合流する】
            const r = await analyzeNonPdf(
              f.doc_role as DocRole,
              f.file_name,
              f.extracted_text,
            );
            summary = r.summary;
            const { error } = await supabase
              .from("case_files")
              .update({ summary: r.summary })
              .eq("id", f.id);
            if (error) throw new Error("解析結果の保存に失敗しました。");
          } else if (f.anthropic_file_id) {
            // 未抽出 PDF。まずコードでテキスト層抽出を試し、取れれば vision を使わず summary のみ生成する
            // （PDF を Claude に送らない＝コスト方針 PRD §7.5）。スキャン/文字化けのみ従来 vision に残す。
            if (!f.storage_path) {
              throw new Error(`「${f.file_name}」の保存場所が見つかりません。`);
            }
            const { data: blob, error: dlError } = await supabase.storage
              .from(CASE_FILES_BUCKET)
              .download(f.storage_path);
            if (dlError || !blob) {
              throw new Error("文書の取得に失敗しました。");
            }
            const extracted = await extractPdfText(blob);
            if (extracted.ok) {
              // テキスト層あり: extracted_text を先に保存（summary 生成が落ちても次回 download+pdfjs を
              // スキップでき冪等性が一段強い）→ その後 summary のみ生成。
              const { error: textError } = await supabase
                .from("case_files")
                .update({ extracted_text: extracted.text })
                .eq("id", f.id);
              if (textError) throw new Error("解析結果の保存に失敗しました。");
              const r = await analyzeNonPdf(
                f.doc_role as DocRole,
                f.file_name,
                extracted.text,
              );
              summary = r.summary;
              const { error } = await supabase
                .from("case_files")
                .update({ summary: r.summary })
                .eq("id", f.id);
              if (error) throw new Error("解析結果の保存に失敗しました。");
            } else {
              // スキャン/文字化け（テキスト層なし）→ 1頁ずつ分割して並列 vision 文字起こし（大部でも60s内）。
              // download 済み blob を再利用（追加 download なし）。原本 anthropic_file_id は図参照用に保持。
              const { full_text } = await transcribePdfByPages(
                blob,
                f.doc_role as DocRole,
                f.file_name,
              );
              // ① 連結 full_text を先に保存（冪等の要。要約が落ちても再 transcribe 不要）。
              const { error: textError } = await supabase
                .from("case_files")
                .update({ extracted_text: full_text })
                .eq("id", f.id);
              if (textError) throw new Error("解析結果の保存に失敗しました。");
              // ② ソフト締切: 転写で時間を使った場合、要約は再送1回に先送りして無言 kill を避ける。
              // この文書は summary 未設定のまま＝allComplete=false で ok=false。再送は
              // extracted_text あり → analyzeNonPdf 直行（~20s）で軽い。
              if (Date.now() - startedAt >= SUMMARY_DEADLINE_MS) {
                send({
                  t: "info",
                  fileName: f.file_name,
                  message: `「${f.file_name}」の全文テキスト化が完了しました。もう一度送信すると要約を生成して完了します。`,
                });
                return;
              }
              // ③ 余裕があれば（小さいスキャン）そのまま要約まで作って1回で完了。
              const r = await analyzeNonPdf(
                f.doc_role as DocRole,
                f.file_name,
                full_text,
              );
              summary = r.summary;
              const { error } = await supabase
                .from("case_files")
                .update({ summary: r.summary })
                .eq("id", f.id);
              if (error) throw new Error("解析結果の保存に失敗しました。");
            }
          } else {
            // file_id も extracted_text も無い（通常 Slice 2 後は起きない防御）。
            throw new Error(`「${f.file_name}」は解析できる内容がありません。`);
          }
          send({ t: "summary", fileName: f.file_name, text: summary });
          send({ t: "doc_done", fileName: f.file_name });
          analyzed.set(f.id, summary);
        } catch (err) {
          // 当該文書のみ失敗として記録（他文書は継続。部分進捗は保存済み）。
          send({
            t: "error",
            fileName: f.file_name,
            message: toUserMessage(err),
          });
        }
      }),
    );

    // 完了判定: 全文書の summary が揃ったか（既存解析済み＋今回分）。
    const summaryOf = (f: (typeof orderedFiles)[number]) => {
      const fresh = analyzed.get(f.id);
      if (fresh) return fresh;
      return typeof f.summary === "string" ? f.summary.trim() : "";
    };
    const allComplete = orderedFiles.every((f) => summaryOf(f).length > 0);

    if (!allComplete) {
      // 一部失敗: messages / current_step は書かず error カードを残す（再送で残りが進む）。
      return false;
    }

    // 冪等化: 既に保存済み（step_no=3 の assistant メッセージあり）なら再保存しない。
    const { data: saved } = await supabase
      .from("messages")
      .select("id")
      .eq("case_id", caseId)
      .eq("step_no", 3)
      .limit(1);
    if (saved && saved.length > 0) {
      return true;
    }

    // assistant チャット本文（DOC_ROLES 順 = orderedFiles 順。見出し＋概要、全文は含めない）。
    const assistantContent = orderedFiles
      .map((f) => `📄 ${f.file_name}\n${summaryOf(f)}`)
      .join("\n\n");
    const userContent =
      message.trim() ||
      "文書を解析して各文書の全文テキスト化と概要を出力してください。";

    const { error: userErr } = await supabase.from("messages").insert({
      case_id: caseId,
      role: "user",
      step_no: 2,
      content: userContent,
    });
    if (userErr) {
      send({ t: "error", message: "メッセージの保存に失敗しました。" });
      return false;
    }

    const { error: assistantErr } = await supabase.from("messages").insert({
      case_id: caseId,
      role: "assistant",
      step_no: 3,
      content: assistantContent,
    });
    if (assistantErr) {
      send({ t: "error", message: "メッセージの保存に失敗しました。" });
      return false;
    }

    await supabase.from("cases").update({ current_step: 3 }).eq("id", caseId);

    return true;
  } catch (err) {
    send({ t: "error", message: toUserMessage(err) });
    return false;
  }
}
