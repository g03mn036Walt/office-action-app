import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";

import { getAnthropic } from "@/lib/anthropic/client";
import { DOC_ROLES, labelForRole, type DocRole } from "@/lib/config/docRoles";
import { modelForStep } from "@/lib/config/models";
import { S2_SYSTEM_PROMPT } from "@/lib/prompts/step2";
import { createClient } from "@/lib/supabase/server";

/**
 * Step2-3（解析・全文テキスト化・要約）のチャットエンドポイント（Slice 3）。
 *
 * 案件の case_files のうち summary 未設定の文書だけを並列で Claude（modelForStep(2)=Sonnet）に渡し、
 * 構造化出力で {summary, full_text} を得る（冪等化: 解析済みは再解析せず既存 summary を流用）。PDF は
 * Files API の file_id を document ブロックで参照し全文テキスト化して extracted_text に保存（コスト方針
 * PRD §7.5 の核心）、非PDF は抽出済みテキストから summary のみ生成する。進捗は NDJSON で逐次返し、
 * 全文書の summary が揃った初回のみ user/assistant メッセージを messages に保存し current_step を 3 に
 * 更新する（再送では重複保存せず、一部失敗時は保存を保留して再送で残りを埋める）。
 *
 * Anthropic SDK はサーバー/Node 前提（lib/anthropic/client.ts は server-only）。複数 PDF の文字起こしは
 * 既定のサーバーレス時間を超えうるため runtime/maxDuration を明示し、streaming で実時間を抑える（PRD §6）。
 * 機密本文（extracted_text/summary/full_text）はログに出さない（CLAUDE.md ガードレール7）。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const FILES_API_BETA = "files-api-2025-04-14";

/** 構造化出力スキーマ（object は additionalProperties:false + required 必須）。 */
const PDF_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "full_text"],
  properties: {
    summary: { type: "string" },
    full_text: { type: "string" },
  },
};

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

/** PDF（file_id）を全文テキスト化 + 概要。streaming + finalMessage で大きい出力に耐える。 */
async function analyzePdf(
  fileId: string,
  role: DocRole,
  fileName: string,
): Promise<{ summary: string; full_text: string }> {
  const final = await getAnthropic()
    .beta.messages.stream({
      model: modelForStep(2),
      max_tokens: 64000,
      betas: [FILES_API_BETA],
      system: S2_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: PDF_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileId } },
            {
              type: "text",
              text: `この文書（${labelForRole(role)}: ${fileName}）について、内容概要(summary)と全文の文字起こし(full_text)を出力してください。スキャンPDFや図中の文字も内容を読み取って文字起こししてください。`,
            },
          ],
        },
      ],
    })
    .finalMessage();
  guardStop(final.stop_reason);
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  const parsed = parseAnalysis(raw, true);
  return { summary: parsed.summary, full_text: parsed.full_text as string };
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

/** SDK の型付きエラー等を和文に変換（生のエラー本文は表に出さない）。 */
function toUserMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "アクセスが集中しています。少し待ってから再送してください。";
  }
  if (err instanceof Anthropic.APIError) {
    return "Claude API でエラーが発生しました。もう一度送信してください。";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "解析中にエラーが発生しました。";
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let caseId = "";
  let message = "";
  try {
    const body = await request.json();
    if (typeof body?.caseId === "string") caseId = body.caseId.trim();
    if (typeof body?.message === "string") message = body.message;
  } catch {
    // body 不正は下の caseId チェックで弾く
  }
  if (!caseId) {
    return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  }

  // 案件の所有確認（RLS で owner 限定。二重防御）。
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
    .eq("id", caseId)
    .single();
  if (!caseRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 解析に必要な列のみ取得（DOC_ROLES 順 → role 内は created_at 昇順に並べ替え）。
  const { data: files, error: filesError } = await supabase
    .from("case_files")
    .select("id, doc_role, file_name, anthropic_file_id, extracted_text, summary, created_at")
    .eq("case_id", caseId);
  if (filesError) {
    return NextResponse.json({ error: "failed to load files" }, { status: 500 });
  }

  const roleOrder = new Map(DOC_ROLES.map((m, i) => [m.role, i] as const));
  const orderedFiles = (files ?? []).slice().sort((a, b) => {
    const ra = roleOrder.get(a.doc_role as DocRole) ?? 99;
    const rb = roleOrder.get(b.doc_role as DocRole) ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      // done は ok 付きで一度だけ送って close。ok=false なら一部失敗で再送が必要。
      let closed = false;
      const finish = (ok: boolean) => {
        if (closed) return;
        closed = true;
        try {
          send({ t: "done", ok });
        } catch {
          // 既に close 済みなら無視
        }
        controller.close();
      };

      try {
        if (orderedFiles.length === 0) {
          send({
            t: "error",
            message:
              "解析する文書がありません。先にファイルをアップロードしてください。",
          });
          finish(false);
          return;
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
              if (f.anthropic_file_id) {
                const r = await analyzePdf(
                  f.anthropic_file_id,
                  f.doc_role as DocRole,
                  f.file_name,
                );
                summary = r.summary;
                const { error } = await supabase
                  .from("case_files")
                  .update({ extracted_text: r.full_text, summary: r.summary })
                  .eq("id", f.id);
                if (error) throw new Error("解析結果の保存に失敗しました。");
              } else if (f.extracted_text) {
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
              } else {
                // file_id も extracted_text も無い（通常 Slice 2 後は起きない防御）。
                throw new Error(
                  `「${f.file_name}」は解析できる内容がありません。`,
                );
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
          finish(false);
          return;
        }

        // 冪等化: 既に保存済み（step_no=3 の assistant メッセージあり）なら再保存しない。
        const { data: saved } = await supabase
          .from("messages")
          .select("id")
          .eq("case_id", caseId)
          .eq("step_no", 3)
          .limit(1);
        if (saved && saved.length > 0) {
          finish(true);
          return;
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
          finish(false);
          return;
        }

        const { error: assistantErr } = await supabase.from("messages").insert({
          case_id: caseId,
          role: "assistant",
          step_no: 3,
          content: assistantContent,
        });
        if (assistantErr) {
          send({ t: "error", message: "メッセージの保存に失敗しました。" });
          finish(false);
          return;
        }

        await supabase.from("cases").update({ current_step: 3 }).eq("id", caseId);

        finish(true);
      } catch (err) {
        try {
          send({ t: "error", message: toUserMessage(err) });
        } catch {
          // 既に close 済みなら無視
        }
        finish(false);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
