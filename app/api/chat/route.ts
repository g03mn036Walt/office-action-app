import { NextResponse, type NextRequest } from "next/server";

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
 *  - autorun …… 指定ステップまで連続実行（Slice 2 で追加。現状は次の 1 ステップ）。
 *  - followup … 現ステップへの追問に回答（`runFollowup`。ステップは進めない）。
 *  - ambiguous … 短い確認を返す（`runClarification`）。
 *
 * Anthropic SDK はサーバー/Node 前提（lib/anthropic/client.ts は server-only）。複数 PDF の文字起こしは
 * 既定のサーバーレス時間を超えうるため runtime/maxDuration を明示し、streaming で実時間を抑える（PRD §6）。
 * 機密本文（extracted_text/summary/full_text）はログに出さない（CLAUDE.md ガードレール7）。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

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
        // 自由入力の意図を分類（§10）。空入力・失敗時は安全側の advance にフォールバックする。
        const intent = await classifyIntent(message, caseRow.current_step);
        let ok: boolean;
        if (intent.mode === "followup") {
          // 現ステップへの追問。ステップは進めない。
          ok = await runFollowup(
            supabase,
            caseId,
            message,
            caseRow.current_step,
            send,
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
        } else {
          // advance / autorun → 次に実行する 1 ステップへ振り分ける。
          // （autorun の「対象ステップまで連続実行」は Slice 2 でクライアント継続方式により追加。）
          const target = nextStepToRun(caseRow.current_step);
          if (target === "analysis") {
            ok = await runAnalysis(supabase, caseId, message, send);
          } else if (target === "unsupported") {
            send({
              t: "error",
              message:
                "検討フローは Step14（書面出力）まで完了しています。追加の対応はまだ実装されていません。",
            });
            ok = false;
          } else {
            ok = await runStep(supabase, caseId, message, target, send);
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
