import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * SDK の型付きエラー等をユーザー向け和文に変換する（生のエラー本文・スタックは表に出さない＝ガードレール7）。
 * 旧 route.ts のローカル関数を集約し、解析パス（runAnalysis）とステップ実行パス（dispatcher）で共通利用する。
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "アクセスが集中しています。少し待ってから再送してください。";
  }
  if (err instanceof Anthropic.APIError) {
    return "Claude API でエラーが発生しました。もう一度送信してください。";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "処理中にエラーが発生しました。";
}
