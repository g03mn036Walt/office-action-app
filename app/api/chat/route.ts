import { NextResponse, type NextRequest } from "next/server";

import type { ModelPref } from "@/lib/config/models";
import { createClient } from "@/lib/supabase/server";
import { nextStepToRun, runStep } from "@/lib/steps/dispatch";
import { toUserMessage } from "@/lib/steps/errors";
import { classifyIntent } from "@/lib/steps/intent";
import { runAnalysis } from "@/lib/steps/runAnalysis";
import { runClarification, runFollowup } from "@/lib/steps/runFollowup";

/**
 * チャットエンドポイント（Phase 2）。
 *
 * 認証・案件所有確認を行い、NDJSON ストリーム（1 イベント＝JSON 1 行）で結果を返す薄いシェル。
 * 自由入力の意図を分類（§10）し、実処理を各実行コアに委譲する:
 *  - advance …… 次の 1 ステップを実行（Step2-3 解析＝`runAnalysis` / Step4+＝`dispatch.runStep`）。
 *  - autorun …… 指定ステップまで連続実行。Vercel Hobby の関数時間制約（60s）に収めるため
 *                **1 リクエスト＝1 ステップ**に保ち、目標未達なら `autorun_continue` を送って
 *                クライアントに継続リクエスト（`autorunTo`）を促す（クライアント継続方式・§7.10）。
 *  - followup … 現ステップへの追問に回答（`runFollowup`。ステップは進めない）。
 *  - ambiguous … 短い確認を返す（`runClarification`）。
 *
 * Anthropic SDK はサーバー/Node 前提（lib/anthropic/client.ts は server-only）。複数 PDF の文字起こしは
 * 既定のサーバーレス時間を超えうるため runtime/maxDuration を明示し、streaming で実時間を抑える（PRD §6）。
 * 機密本文（extracted_text/summary/full_text）はログに出さない（CLAUDE.md ガードレール7）。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type Send = (obj: unknown) => void;
type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** current_step から次に実行する 1 ステップを決めて実行する（解析 / Step4+ / 完了）。 */
async function runOneStep(
  supabase: ServerSupabase,
  caseId: string,
  message: string,
  currentStep: number,
  send: Send,
  cache = false,
  model?: ModelPref,
): Promise<boolean> {
  const target = nextStepToRun(currentStep);
  if (target === "analysis") {
    return runAnalysis(supabase, caseId, message, send, model);
  }
  if (target === "unsupported") {
    send({
      t: "error",
      message:
        "検討フローは Step14（書面出力）まで完了しています。追加の対応はまだ実装されていません。",
    });
    return false;
  }
  return runStep(supabase, caseId, message, target, send, { cache, model });
}

/**
 * オートラン継続の判定（§7.10）。直前のステップ成功後に current_step を読み直し、まだ目標
 * （target=停止させたい current_step）に達していなければ `autorun_continue` を送る。
 * 実際の連続化（次リクエスト送信）はクライアントが担う（Hobby の関数時間内に 1 ステップずつ）。
 */
async function maybeSignalAutorun(
  supabase: ServerSupabase,
  caseId: string,
  target: number,
  send: Send,
): Promise<void> {
  const { data } = await supabase
    .from("cases")
    .select("current_step")
    .eq("id", caseId)
    .single();
  const cur = data?.current_step ?? 0;
  if (cur < target && nextStepToRun(cur) !== "unsupported") {
    send({ t: "autorun_continue", target });
  }
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
  // オートラン継続リクエストのとき、到達させたい current_step（クライアントが echo する）。
  let autorunTo: number | null = null;
  // UI モデルピッカーの選択（sonnet=標準 / opus=高品質。未指定・不正値は既定＝Sonnet）。
  let model: ModelPref | undefined;
  try {
    const body = await request.json();
    if (typeof body?.caseId === "string") caseId = body.caseId.trim();
    if (typeof body?.message === "string") message = body.message;
    if (typeof body?.autorunTo === "number") {
      // 妥当な停止点の範囲に丸める（不正値でも暴走しないよう上限 15）。
      autorunTo = Math.min(Math.max(Math.trunc(body.autorunTo), 5), 15);
    }
    if (body?.model === "sonnet" || body?.model === "opus") {
      model = body.model;
    }
  } catch {
    // body 不正は下の caseId チェックで弾く
  }
  if (!caseId) {
    return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  }

  // 案件の所有確認（RLS で owner 限定。二重防御）。current_step でステップを振り分ける。
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, current_step")
    .eq("id", caseId)
    .single();
  if (!caseRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

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
        let ok: boolean;
        if (autorunTo != null) {
          // オートラン継続リクエスト: 分類せず次の 1 ステップを実行し、未達なら継続を促す。
          // 連続実行なので文書ブロックをキャッシュする（§7.5）。
          ok = await runOneStep(
            supabase,
            caseId,
            "",
            caseRow.current_step,
            send,
            true,
            model,
          );
          if (ok) await maybeSignalAutorun(supabase, caseId, autorunTo, send);
        } else {
          // 初回リクエスト: 自由入力の意図を分類（§10）。空入力・失敗時は安全側の advance。
          const intent = await classifyIntent(message, caseRow.current_step);
          if (intent.mode === "followup") {
            // 現ステップへの追問。ステップは進めない。
            ok = await runFollowup(
              supabase,
              caseId,
              message,
              caseRow.current_step,
              send,
              model,
            );
          } else if (intent.mode === "ambiguous") {
            // 意図が掴めない場合は短い確認を返す（進めない）。
            ok = await runClarification(
              supabase,
              caseId,
              message,
              caseRow.current_step,
              send,
            );
          } else if (intent.mode === "autorun") {
            // 初回オートラン: 最初の 1 ステップを実行し、目標未達なら継続を促す（文書はキャッシュ・§7.5）。
            ok = await runOneStep(
              supabase,
              caseId,
              message,
              caseRow.current_step,
              send,
              true,
              model,
            );
            if (ok) {
              await maybeSignalAutorun(
                supabase,
                caseId,
                intent.target_step,
                send,
              );
            }
          } else {
            // advance: 次の 1 ステップのみ。
            ok = await runOneStep(
              supabase,
              caseId,
              message,
              caseRow.current_step,
              send,
              false,
              model,
            );
          }
        }
        finish(ok);
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
