# office-action-app（OA 応答支援アプリ）

各国特許庁のオフィスアクション（OA / 拒絶理由通知）への応答を Claude API で支援する社内 Web アプリ。
Claude チャットライクな UI 上で、本願・OA・引用文献・現クレームをアップロードし、ステップ式（全14ステップ）に
「文書理解 → 妥当性評価 → 応答方針 → 補正案 → 意見書 → Word 出力」を進める。

> 仕様の唯一の正（source of truth）は [`docs/PRD.md`](docs/PRD.md)。運用ルールは [`CLAUDE.md`](CLAUDE.md) を参照。

## 技術スタック

- Next.js（App Router）/ React / TypeScript
- Tailwind CSS
- Supabase（Auth: Google + Email/Pass、Postgres + RLS、Storage）
- Anthropic Claude API（公式 SDK `@anthropic-ai/sdk`、サーバー側のみ）
- Vercel（ホスティング）
- Word 生成: `docx`（サーバー側で生成）

## セットアップ

```bash
# 1. 依存をインストール
npm install

# 2. 環境変数を設定（下記「環境変数」を参照）
#    .env.local を作成し、各キーを埋める

# 3. 開発サーバーを起動
npm run dev
```

起動後、http://localhost:3000 を開く。未ログインの場合は `/login` にリダイレクトされる。

## 環境変数

`.env.local`（ローカル）および Vercel のプロジェクト設定に登録する。

| 変数名 | 用途 | 備考 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude API キー | サーバー専用。`NEXT_PUBLIC_` を付けない |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL | クライアント公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key（`sb_publishable_…`） | クライアント公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key（`sb_secret_…`） | サーバー側のみ。クライアントに出さない |

> Supabase の API キーは新方式を採用（anon に publishable key、service_role に secret key）。legacy JWT（`eyJ…`）は使わない。
> `.env*` は Git 管理外。秘密値はコミットしない。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run lint` | Lint |

## ディレクトリ構成（主要）

```
app/                  ルーティング・画面・Route Handler（app/api/chat 等）
components/           UI コンポーネント（components/ui は Claude Design 由来）
lib/
  env.ts             公開可能な環境変数（NEXT_PUBLIC_*）の取得
  supabase/          client（ブラウザ）/ server（サーバー）/ admin（service_role）
  anthropic/         Claude API のサーバー専用クライアント
  config/models.ts   「ステップ→モデル」設定の一元管理
  database.types.ts  Supabase から生成した型
supabase/migrations/ DB スキーマ・RLS・Storage の正（Git 管理）
docs/PRD.md           要件定義の正
```

## セキュリティ要点（Guardrails）

- Claude API キーはクライアントに出さない。API 呼び出しは必ずサーバー側（Route Handler / Server Action）。
- Supabase は初日から RLS 有効。各ユーザーは自分のデータのみアクセス可。
- 機密文書の本文はログ（`console.log`）に残さない。
- 視覚設計の正は Claude Design（claude.ai/design）。`/design-sync` で `components/ui/` に同期して実装する。

詳細は [`CLAUDE.md`](CLAUDE.md) / [`docs/PRD.md`](docs/PRD.md) を参照。

---

> 本 README は Phase 0（基盤）時点の内容。機能追加に応じて随時更新する。
