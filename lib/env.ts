/**
 * 公開可能（クライアントに出してよい）な環境変数を、欠落時に明示エラーにして取り出す。
 *
 * NEXT_PUBLIC_* はビルド時に文字列リテラルとしてインライン置換されるため、
 * `process.env.NEXT_PUBLIC_xxx` を「直接」参照する必要がある（動的キーアクセスは
 * クライアントバンドルで置換されず undefined になる）。
 *
 * service_role など秘密値はここに置かない（クライアントへ漏らさないため lib/supabase/admin.ts に閉じ込める）。
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
