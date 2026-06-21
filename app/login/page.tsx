"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Brandmark } from "@/components/ui/Brandmark";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const pwMismatch = isSignup && password2.length > 0 && password !== password2;
  const pwMatched =
    isSignup && password2.length > 0 && password === password2 && password.length > 0;

  const heading = isSignup ? "アカウントを作成" : "おかえりなさい";
  const actionVerb = isSignup ? "登録" : "ログイン";
  const submitLabel = isSignup ? "アカウントを作成" : "ログイン";
  const switchPrompt = isSignup
    ? "すでにアカウントをお持ちですか？"
    : "アカウントをお持ちでない場合";
  const switchAction = isSignup ? "ログイン" : "新規登録";

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (isSignup && password !== password2) {
      setError("パスワードが一致しません。");
      return;
    }

    setLoading(true);

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) {
        setError(error.message);
      } else if (data.session) {
        // メール確認が無効ならそのままログイン状態になる
        router.replace("/");
        router.refresh();
      } else {
        setNotice("確認メールを送信しました。メール内のリンクを開いてください。");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        router.replace("/");
        router.refresh();
      }
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    }
  }

  function toggleMode(e: React.MouseEvent) {
    e.preventDefault();
    setMode(isSignup ? "signin" : "signup");
    setShowPassword(false);
    setPassword2("");
    setError(null);
    setNotice(null);
  }

  const fieldClass =
    "h-[46px] w-full rounded-[10px] border bg-surface px-3.5 text-[15px] text-ink outline-none transition focus:border-terracotta focus:ring-[3px] focus:ring-terracotta/15";

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-cream px-5 py-10 text-ink">
      <div className="mb-[30px] flex flex-col items-center gap-[26px]">
        <Brandmark size="lg" layout="stack" />
        <h1 className="m-0 text-center font-serif text-[26px] font-normal leading-[1.2] tracking-[-0.01em] text-ink-soft">
          {heading}
        </h1>
      </div>

      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-8 shadow-[0_1px_3px_rgba(31,30,29,0.04),0_8px_24px_rgba(31,30,29,0.04)]">
        <button
          type="button"
          onClick={handleGoogle}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] border border-field bg-surface text-[15px] font-medium text-ink transition-colors hover:border-terracotta hover:bg-cream-hover"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"
              fill="#34A853"
            />
            <path
              d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"
              fill="#EA4335"
            />
          </svg>
          Google で{actionVerb}
        </button>

        <div className="my-[22px] flex items-center gap-3.5">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-faint">または</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
          {isSignup && (
            <div className="flex flex-col gap-[7px]">
              <label className="text-[13px] font-medium text-ink-soft">氏名</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山田 太郎"
                className={`${fieldClass} border-field`}
              />
            </div>
          )}

          <div className="flex flex-col gap-[7px]">
            <label className="text-[13px] font-medium text-ink-soft">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`${fieldClass} border-field`}
            />
          </div>

          <div className="flex flex-col gap-[7px]">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-ink-soft">パスワード</label>
              {!isSignup && (
                <button
                  type="button"
                  onClick={() => setNotice("パスワードリセットは準備中です。")}
                  className="text-xs text-muted-2 transition-colors hover:text-terracotta"
                >
                  パスワードを忘れた場合
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${fieldClass} border-field pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                className="absolute right-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-[7px] border-none bg-transparent text-faint transition-colors hover:text-ink-soft"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M1.5 9S4.5 3.5 9 3.5 16.5 9 16.5 9 13.5 14.5 9 14.5 1.5 9 1.5 9Z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" />
                    <path
                      d="M2.5 2.5l13 13"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M1.5 9S4.5 3.5 9 3.5 16.5 9 16.5 9 13.5 14.5 9 14.5 1.5 9 1.5 9Z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {isSignup && (
            <div className="flex flex-col gap-[7px]">
              <label className="text-[13px] font-medium text-ink-soft">
                パスワード（確認）
              </label>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="••••••••"
                className={`${fieldClass} ${
                  pwMismatch
                    ? "border-[#D88A7A]"
                    : pwMatched
                      ? "border-[#7FC0A0]"
                      : "border-field"
                }`}
              />
              {pwMismatch && (
                <span className="flex items-center gap-1.5 text-xs text-error">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                    <path
                      d="M7 4v3.5M7 9.6v.1"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  パスワードが一致しません
                </span>
              )}
              {pwMatched && (
                <span className="flex items-center gap-1.5 text-xs text-success">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2.5 7.5l3 3 6-6.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  パスワードが一致しています
                </span>
              )}
            </div>
          )}

          {error && <p className="text-[13px] text-error">{error}</p>}
          {notice && <p className="text-[13px] text-success">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 h-12 w-full rounded-[10px] border-none bg-terracotta text-[15px] font-medium text-white transition-colors hover:bg-terracotta-dark disabled:opacity-50"
          >
            {loading ? "処理中..." : submitLabel}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm text-muted">
        {switchPrompt}
        <a
          href="#"
          onClick={toggleMode}
          className="ml-1 font-medium text-terracotta transition-colors hover:underline"
        >
          {switchAction}
        </a>
      </p>

      <p className="mt-8 max-w-[340px] text-center text-xs leading-[1.6] text-faint">
        続行することで、
        <a href="#" className="text-muted-2">
          利用規約
        </a>
        および
        <a href="#" className="text-muted-2">
          プライバシーポリシー
        </a>
        に同意したものとみなされます。
      </p>
    </main>
  );
}
