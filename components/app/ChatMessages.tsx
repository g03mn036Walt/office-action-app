/**
 * チャットメッセージ表示（Slice 3）。永続化済み messages を時系列で吹き出し表示する。
 * 純粋な表示コンポーネント（状態を持たない）。ストリーミング中の途中表示は親（Chat）が担う。
 */

export type ChatMessage = {
  id: string;
  role: string;
  content: string | null;
};

/** 1 メッセージの吹き出し（user=右寄せ/terracotta、assistant=左寄せ/カード）。PRD §9.2c。 */
export function Bubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] px-4 py-2.5 text-[14px] leading-relaxed ${
          isUser
            ? "bg-terracotta text-white"
            : "border border-line bg-surface text-ink"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        文書をアップロードして送信すると、各文書の全文テキスト化と概要の解析が始まります。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <Bubble key={m.id} role={m.role} content={m.content ?? ""} />
      ))}
    </div>
  );
}
