import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { toUserMessage } from "@/lib/steps/errors";
import { runAnalysis } from "@/lib/steps/runAnalysis";

/**
 * チャットエンドポイント（Slice 3 / Phase 2）。
 *
 * 認証・案件所有確認を行い、NDJSON ストリーム（1 イベント＝JSON 1 行）でステップ実行を返す薄いシェル。
 * 実処理は各ステップの実行コアに委譲する:
 *  - Step2-3（解析・全文テキスト化・要約）= `lib/steps/runAnalysis`（2b 実装を抽出）。
 *  - Step4+（妥当性評価・応答方針 …）= 後続スライスでディスパッチを追加（current_step で振り分け）。
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

  // 案件の所有確認（RLS で owner 限定。二重防御）。
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
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
        const ok = await runAnalysis(supabase, caseId, message, send);
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
