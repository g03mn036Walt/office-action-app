import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude API を叩くサーバー専用クライアント。
 *
 * `import "server-only"` により、誤ってクライアントから import するとビルドで失敗する。
 * `ANTHROPIC_API_KEY` は NEXT_PUBLIC を付けず、このモジュール内でのみ参照する（Guardrail 1）。
 * API 呼び出しは必ずサーバー側（Route Handler / Server Action）から行うこと。
 */
function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: ANTHROPIC_API_KEY");
  }
  return key;
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({ apiKey: requireApiKey() });
  }
  return cached;
}
