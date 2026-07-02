"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";

import type { ModelPref } from "@/lib/config/models";

/**
 * チャット入力（Slice 3 / モデルピッカー付き）。テキスト入力 + モデル選択 + 送信ボタン。
 * Enter で送信 / Shift+Enter で改行。空送信は「解析を開始する」トリガとして許容する。
 * 実際の送信処理（fetch / NDJSON ストリーム読取）は親（Chat）が onSend で受け持つ。
 *
 * モデルピッカー: 各送信＝そのとき実行されるステップに適用（既定 Sonnet、Opus=高品質・高コスト）。
 * 現在の見た目は既存トークンのみの暫定実装。Claude Design（office-action-app-ui）の
 * モデル選択ボタンのハンドオフ後に、そのデザインへ差し替える（PRD §9.0）。
 */

/** ピッカーの選択肢（表示ラベルと補足）。 */
const MODEL_OPTIONS: { value: ModelPref; label: string; hint: string }[] = [
  { value: "sonnet", label: "Sonnet", hint: "標準（コスト重視）" },
  { value: "opus", label: "Opus", hint: "高品質（コスト高）" },
];

function ModelPicker({
  model,
  onChange,
  disabled,
}: {
  model: ModelPref;
  onChange: (m: ModelPref) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="使用モデル"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-cream p-0.5"
    >
      {MODEL_OPTIONS.map((o) => {
        const selected = o.value === model;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? "bg-surface text-ink shadow-sm"
                : "text-muted hover:text-ink-soft"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChatInput({
  onSend,
  disabled,
  model,
  onModelChange,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  model: ModelPref;
  onModelChange: (m: ModelPref) => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    if (disabled) return;
    onSend(text);
    setText("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-field bg-surface p-3.5"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={disabled ? "解析中…" : "メッセージを入力…（送信で解析開始）"}
        className="max-h-40 min-h-[24px] w-full resize-none bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <ModelPicker model={model} onChange={onModelChange} disabled={disabled} />
        <button
          type="submit"
          disabled={disabled}
          className="shrink-0 rounded-lg bg-terracotta px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terracotta-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </form>
  );
}
