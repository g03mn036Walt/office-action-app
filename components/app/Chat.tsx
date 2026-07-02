"use client";

import { type ReactNode, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ArtifactKind, ChatEvent } from "@/lib/chat/events";
import type { ModelPref } from "@/lib/config/models";
import type {
  DocxDeliverResult,
  FullAmendmentResult,
  OpinionResult,
  RepAmendmentResult,
  StrategyResult,
  ValidityResult,
} from "@/lib/steps/schemas";

import { ChatInput } from "./ChatInput";
import { Bubble, type TimelineItem } from "./ChatMessages";
import { DocxView } from "./DocxView";
import { FullAmendmentView } from "./FullAmendmentView";
import { OpinionView } from "./OpinionView";
import { RepAmendmentView } from "./RepAmendmentView";
import { StrategyView } from "./StrategyView";
import { ValidityChart } from "./ValidityChart";

/**
 * チャット領域（Slice 3 / Phase 2）。案件ビューのヘッダ下＝スクロール領域（文書＋メッセージ）＋下部入力枠を担う。
 *
 * 文書アップロード UI（server レンダリング）は children として受け取りスクロール領域上部に置く。
 * 送信時に /api/chat へ POST し、NDJSON（@/lib/chat/events の ChatEvent）を逐次読んで途中状態を表示する:
 *  - Step2-3 解析: doc_start/summary/doc_done/info を文書カードに反映。
 *  - Step4+（妥当性/応答方針 …）: step_start/text_delta/artifact/step_done を「実行中」ブロックに反映し、
 *    artifact は kind に応じて ValidityChart / StrategyView でライブ描画する。
 * 全件成功の done（ok!==false）でのみサーバーの永続メッセージを取り直し（router.refresh）楽観表示を破棄する。
 * 一部失敗（ok===false）では進捗・エラー表示を残し、再送で残りを進める。
 * 永続化済みの構造化成果物は案件ページ（page.tsx）が initialItems の timeline に含めて再描画する（docx は署名 URL を再発行）。
 */

type RunDoc = {
  fileName: string;
  status: "reading" | "done" | "error";
  summary?: string;
  note?: string;
  error?: string;
};

/**
 * Step4+ の実行中状態（1 リクエスト＝1 ステップ）。
 * mode="step": 正規ステップの実行（Step N のヘッダ＋成果物）。
 * mode="text": 追問への回答など、ステップを進めない逐次テキスト（アシスタント吹き出しで表示）。
 */
type StepRun = {
  step: number;
  status: "running" | "done" | "error";
  mode: "step" | "text";
  text: string;
  artifact: { kind: ArtifactKind; payload: unknown } | null;
};

/** 構造化成果物を種別に応じて描画（payload は実行時 unknown 由来。各 View 側で防御）。 */
function StepArtifact({
  artifact,
}: {
  artifact: { kind: ArtifactKind; payload: unknown };
}) {
  switch (artifact.kind) {
    case "validity":
      return <ValidityChart result={artifact.payload as ValidityResult} />;
    case "strategies":
      return <StrategyView result={artifact.payload as StrategyResult} />;
    case "rep_amendment":
      return (
        <RepAmendmentView result={artifact.payload as RepAmendmentResult} />
      );
    case "full_amendment":
      return (
        <FullAmendmentView result={artifact.payload as FullAmendmentResult} />
      );
    case "opinion":
      return <OpinionView result={artifact.payload as OpinionResult} />;
    case "docx":
      return <DocxView result={artifact.payload as DocxDeliverResult} />;
    default:
      return null;
  }
}

export function Chat({
  caseId,
  initialItems,
  children,
}: {
  caseId: string;
  initialItems: TimelineItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [userBubble, setUserBubble] = useState<string | null>(null);
  const [runDocs, setRunDocs] = useState<RunDoc[]>([]);
  const [stepRun, setStepRun] = useState<StepRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autorunActive, setAutorunActive] = useState(false);
  // モデルピッカー（各送信＝そのとき実行されるステップに適用。既定 Sonnet・永続化なし）。
  const [modelPref, setModelPref] = useState<ModelPref>("sonnet");
  // オートラン継続の目標（到達させたい current_step）。サーバーの autorun_continue で設定し、
  // done 後に継続リクエストを投げる（Hobby の関数時間内に 1 ステップずつ・§7.10）。
  const autorunTargetRef = useRef<number | null>(null);

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
      case "info":
        // 全文テキスト化は完了したが要約は再送に先送り（中立の案内。エラーではない）。
        setRunDocs((d) =>
          d.map((x) =>
            x.fileName === ev.fileName
              ? { ...x, status: "done", note: ev.message }
              : x,
          ),
        );
        break;
      case "step_start":
        setStepRun({
          step: ev.step,
          status: "running",
          mode: "step",
          text: "",
          artifact: null,
        });
        break;
      case "text_delta":
        // text_delta のみで始まる流れ＝追問の回答（mode="text"）。step_start 先行なら mode を保つ。
        setStepRun((s) =>
          s
            ? { ...s, text: s.text + ev.text }
            : {
                step: ev.step,
                status: "running",
                mode: "text",
                text: ev.text,
                artifact: null,
              },
        );
        break;
      case "artifact":
        setStepRun((s) =>
          s
            ? { ...s, artifact: { kind: ev.kind, payload: ev.payload } }
            : {
                step: ev.step,
                status: "running",
                mode: "step",
                text: "",
                artifact: { kind: ev.kind, payload: ev.payload },
              },
        );
        break;
      case "step_done":
        setStepRun((s) => (s ? { ...s, status: "done" } : s));
        break;
      case "autorun_advance":
        // 進捗表示用（現状は未使用。継続制御は autorun_continue で行う）。
        break;
      case "autorun_continue":
        // まだ目標に達していない。done 後に継続リクエストを投げる（handleSend のループが参照）。
        autorunTargetRef.current = ev.target;
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
        // ステップ実行中のエラーは実行中ブロックの状態も error にする。
        setStepRun((s) => (s ? { ...s, status: "error" } : s));
        setError(ev.message);
        break;
      case "done":
        // 一部失敗 / 文書なし（ok===false）は進捗・エラー表示を保持（再送で残りを進める）。
        if (ev.ok === false) break;
        // オートラン継続中（次ステップあり）は軽くリセットのみ（refresh せず userBubble も保持）。
        if (autorunTargetRef.current != null) {
          setStepRun(null);
          break;
        }
        // 最終ステップのみ楽観表示を破棄し、サーバーの確定メッセージを取り直す。
        setUserBubble(null);
        setRunDocs([]);
        setStepRun(null);
        setError(null);
        router.refresh();
        break;
    }
  }

  /** 1 リクエスト分のストリームを読み、done の ok を返す（applyEvent で逐次反映）。 */
  async function runOnce(body: {
    message?: string;
    autorunTo?: number;
  }): Promise<boolean> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // model はオートラン継続リクエストにも同じ選択を引き継ぐ。
      body: JSON.stringify({ caseId, model: modelPref, ...body }),
    });
    if (!res.ok || !res.body) {
      setError("送信に失敗しました。もう一度お試しください。");
      return false;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let ok = true;
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line) as ChatEvent;
        if (ev.t === "done") ok = ev.ok !== false;
        applyEvent(ev);
      } catch {
        // 不完全/不正な行は無視
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      if (done) break;
    }
    if (buf.trim()) handleLine(buf);
    return ok;
  }

  async function handleSend(text: string) {
    if (running) return;
    setRunning(true);
    setError(null);
    setRunDocs([]);
    setStepRun(null);
    setUserBubble(text.trim() || "（実行）");
    autorunTargetRef.current = null;

    try {
      let ok = await runOnce({ message: text });
      // オートラン: サーバーが autorun_continue を送る間、目標まで 1 ステップずつ継続する。
      // 全 14 ステップ相当を上限にした反復ガード（万一ステップが前進しなくても暴走させない）。
      let iterations = 0;
      while (ok && autorunTargetRef.current != null && iterations < 16) {
        iterations += 1;
        const target = autorunTargetRef.current;
        autorunTargetRef.current = null; // 継続が続けばサーバーが再設定する
        setAutorunActive(true);
        setStepRun(null);
        ok = await runOnce({ autorunTo: target });
      }
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      autorunTargetRef.current = null;
      setAutorunActive(false);
      setRunning(false);
    }
  }

  const showRun =
    userBubble !== null ||
    runDocs.length > 0 ||
    stepRun !== null ||
    autorunActive;

  return (
    <>
      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto max-w-[720px] space-y-7 px-6">
          {children}

          {initialItems.length === 0 ? (
            <p className="text-[13px] text-muted">
              文書をアップロードして送信すると、各文書の全文テキスト化と概要の解析が始まります。
            </p>
          ) : (
            <div className="space-y-4">
              {initialItems.map((it) =>
                it.type === "message" ? (
                  <Bubble key={it.id} role={it.role} content={it.content ?? ""} />
                ) : (
                  <StepArtifact
                    key={it.id}
                    artifact={{ kind: it.kind, payload: it.payload }}
                  />
                ),
              )}
            </div>
          )}

          {showRun && (
            <div className="space-y-4">
              {userBubble !== null && <Bubble role="user" content={userBubble} />}
              {autorunActive && (
                <p className="text-[12.5px] text-muted">
                  オートラン実行中… 目標ステップまで自動で進めています。
                </p>
              )}
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
                        {d.note && (
                          <div className="mt-0.5 text-[13px] text-muted">
                            {d.note}
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
              {stepRun && stepRun.mode === "text" && (
                // 追問の回答（ステップは進めない）。アシスタント吹き出しとして逐次表示。
                <div className="space-y-2">
                  {stepRun.text && (
                    <Bubble role="assistant" content={stepRun.text} />
                  )}
                  {stepRun.status === "running" && !stepRun.text && (
                    <p className="text-[13px] text-muted">回答中…</p>
                  )}
                </div>
              )}
              {stepRun && stepRun.mode === "step" && (
                <div className="space-y-3">
                  <div className="text-[13px] font-semibold text-ink-soft">
                    {stepRun.status === "running" && `Step ${stepRun.step} 実行中…`}
                    {stepRun.status === "done" && `Step ${stepRun.step} 完了`}
                    {stepRun.status === "error" &&
                      `Step ${stepRun.step} でエラーが発生しました`}
                  </div>
                  {stepRun.text && (
                    <div className="whitespace-pre-wrap break-words rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink">
                      {stepRun.text}
                    </div>
                  )}
                  {stepRun.artifact && (
                    <StepArtifact artifact={stepRun.artifact} />
                  )}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-[12.5px] text-error">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-6 py-4">
        <div className="mx-auto max-w-[720px]">
          <ChatInput
            onSend={handleSend}
            disabled={running}
            model={modelPref}
            onModelChange={setModelPref}
          />
        </div>
      </div>
    </>
  );
}
