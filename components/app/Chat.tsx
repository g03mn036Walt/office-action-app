"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatInput } from "./ChatInput";
import { Bubble, ChatMessages, type ChatMessage } from "./ChatMessages";

/**
 * チャット領域（Slice 3）。案件ビューのヘッダ下＝スクロール領域（文書＋メッセージ）＋下部入力枠を担う。
 *
 * 文書アップロード UI（server レンダリング）は children として受け取りスクロール領域上部に置く。
 * 送信時に /api/chat へ POST し、NDJSON（doc_start/summary/doc_done/error/done）を逐次読んで
 * 解析の途中状態を表示する。done でサーバーの永続メッセージを取り直し（router.refresh）、楽観表示を破棄する。
 * 永続メッセージは initialMessages prop を直接表示するため、refresh 後は確定値で再描画される。
 */

type RunDoc = {
  fileName: string;
  status: "reading" | "done" | "error";
  summary?: string;
  error?: string;
};

type ChatEvent =
  | { t: "doc_start"; fileName: string; role: string }
  | { t: "summary"; fileName: string; text: string }
  | { t: "doc_done"; fileName: string }
  | { t: "error"; fileName?: string; message: string }
  | { t: "done" };

export function Chat({
  caseId,
  initialMessages,
  children,
}: {
  caseId: string;
  initialMessages: ChatMessage[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [userBubble, setUserBubble] = useState<string | null>(null);
  const [runDocs, setRunDocs] = useState<RunDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  function applyEvent(ev: ChatEvent) {
    switch (ev.t) {
      case "doc_start":
        setRunDocs((d) => [...d, { fileName: ev.fileName, status: "reading" }]);
        break;
      case "summary":
        setRunDocs((d) =>
          d.map((x) =>
            x.fileName === ev.fileName ? { ...x, summary: ev.text } : x,
          ),
        );
        break;
      case "doc_done":
        setRunDocs((d) =>
          d.map((x) =>
            x.fileName === ev.fileName ? { ...x, status: "done" } : x,
          ),
        );
        break;
      case "error":
        if (ev.fileName) {
          setRunDocs((d) =>
            d.map((x) =>
              x.fileName === ev.fileName
                ? { ...x, status: "error", error: ev.message }
                : x,
            ),
          );
        }
        setError(ev.message);
        break;
      case "done":
        setUserBubble(null);
        setRunDocs([]);
        setError(null);
        router.refresh();
        break;
    }
  }

  async function handleSend(text: string) {
    if (running) return;
    setRunning(true);
    setError(null);
    setRunDocs([]);
    setUserBubble(text.trim() || "（解析を実行）");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message: text }),
      });
      if (!res.ok || !res.body) {
        setError("送信に失敗しました。もう一度お試しください。");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            applyEvent(JSON.parse(line) as ChatEvent);
          } catch {
            // 不完全/不正な行は無視
          }
        }
        if (done) break;
      }
      if (buf.trim()) {
        try {
          applyEvent(JSON.parse(buf) as ChatEvent);
        } catch {
          // 無視
        }
      }
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setRunning(false);
    }
  }

  const showRun = userBubble !== null || runDocs.length > 0;

  return (
    <>
      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto max-w-[720px] space-y-7 px-6">
          {children}

          <ChatMessages messages={initialMessages} />

          {showRun && (
            <div className="space-y-4">
              {userBubble !== null && <Bubble role="user" content={userBubble} />}
              {runDocs.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink">
                    {runDocs.map((d) => (
                      <div key={d.fileName}>
                        <div className="text-[13px] font-semibold text-ink-soft">
                          📄 {d.fileName}
                        </div>
                        {d.status === "reading" && (
                          <div className="text-[13px] text-muted">読み込み中…</div>
                        )}
                        {d.summary && (
                          <div className="mt-0.5 whitespace-pre-wrap break-words">
                            {d.summary}
                          </div>
                        )}
                        {d.status === "error" && d.error && (
                          <div className="text-[13px] text-error">{d.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-[12.5px] text-error">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-6 py-4">
        <div className="mx-auto max-w-[720px]">
          <ChatInput onSend={handleSend} disabled={running} />
        </div>
      </div>
    </>
  );
}
