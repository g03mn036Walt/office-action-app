"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";

/**
 * チャット入力（Slice 3）。テキスト入力 + 送信ボタン。
 * Enter で送信 / Shift+Enter で改行。空送信は「解析を開始する」トリガとして許容する。
 * 実際の送信処理（fetch / NDJSON ストリーム読取）は親（Chat）が onSend で受け持つ。
 */
export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
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
      className="flex items-end gap-2 rounded-xl border border-field bg-surface p-3.5"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={disabled ? "解析中…" : "メッセージを入力…（送信で解析開始）"}
        className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled}
        className="shrink-0 rounded-lg bg-terracotta px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terracotta-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        送信
      </button>
    </form>
  );
}
