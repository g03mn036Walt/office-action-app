import { NextResponse, type NextRequest } from "next/server";

import { getAnthropic } from "@/lib/anthropic/client";
import { DEFAULT_MODEL } from "@/lib/config/models";
import { createClient } from "@/lib/supabase/server";

/**
 * 0-6 疎通用の最小チャットエンドポイント。
 * Claude にストリーミングで 1 往復し、本文テキストを `text/plain` で逐次返す。
 *
 * 認証: proxy でも未認証は弾くが、API は 401 を返すべきなのでここでも検証する（二重防御）。
 * 本格的なチャット UI / コンテキスト組み立ては Phase 1 以降で実装する。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // body.message が無ければ疎通確認用の既定文言を使う（本文はログに出さない）。
  let message = "Hello";
  try {
    const body = await request.json();
    if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // body 無し / 不正 JSON は既定文言で続行
  }

  const client = getAnthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const events = await client.messages.create({
          model: DEFAULT_MODEL,
          max_tokens: 256,
          messages: [{ role: "user", content: message }],
          stream: true,
        });
        for await (const event of events) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
