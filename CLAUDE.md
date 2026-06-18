@AGENTS.md

# CLAUDE.md

> このファイルはリポジトリ直下に置く。Claude Code が毎回自動で読み込む前提の運用ルール。
> 詳細な仕様は **`docs/PRD.md` が唯一の正（source of truth）**。迷ったら必ず PRD を参照すること。

## プロジェクト概要
各国特許庁のオフィスアクション（OA）への応答を Claude API で支援する社内 Web アプリ。
Claude チャットライクな UI 上で、本願・OA・引用文献・現クレームをアップロードし、
ステップ式（全14ステップ）に「文書理解 → 妥当性評価 → 応答方針 → 補正案 → 意見書 → Word出力」を進める。

## 技術スタック
- Next.js（App Router）/ React / TypeScript
- Tailwind CSS
- Supabase（Auth: Google + Email/Pass / Postgres + RLS / Storage）
- Anthropic Claude API（公式 SDK `@anthropic-ai/sdk`、サーバー側のみ）
- Vercel（ホスティング）
- Word 生成: `docx`（npm）をサーバー側で使用

## 絶対に守るルール（Guardrails）
1. **Claude API キーをクライアントに絶対出さない**。API 呼び出しは必ず Next.js のサーバー側（Route Handler / Server Action）。`ANTHROPIC_API_KEY` に `NEXT_PUBLIC_` を付けない。
2. **Supabase は初日から RLS を有効化**。各ユーザーは自分のデータのみアクセス可。
3. **コスト方針（重要）**: 文書は Step2-3 で全文テキスト化して Supabase（`case_files.extracted_text`）に保存し、**Step4 以降は原本 PDF を毎回送らず保存済みテキストを送る**。図面が重要な場面のみ `file_id` で原本参照。プロンプトキャッシュは**オートラン（連続実行）時のみ採用してよい**（手動の逐次利用では無効。PRD §7.5/§7.10）。
4. **Files API を積極利用**。Step1 で全 PDF をアップロードし `file_id` を `case_files.anthropic_file_id` に保存。案件削除時は `file_id` も DELETE する。beta ヘッダ `files-api-2025-04-14` が必要。
5. **PDF はネイティブに読める**（vision でテキスト＋図表、スキャンも可）。別途 OCR ライブラリは原則入れない。.docx/.txt/.md/.csv はサーバー側でテキスト抽出（.docx は `mammoth`）。100ページ超は分割して読み込む。
6. **Word(.docx) は Claude にバイナリ生成させない**。Claude には構造化テキストを出させ、アプリ側が `docx` で生成 → Storage 保存 → 署名付き URL で DL。補正書・意見書は**各国（JP/US/EP/WO/CN）フォーマットに従う**。
7. **機密保持**: 個人アカウント利用・アップロードは主に公知情報のため **ZDR 不要**。ただしログに文書本文を残さない。
8. Claude 応答は**ストリーミング**で受けて逐次表示する。
9. **「進む」判定は自由入力**（確認ボタンなし）。指定ステップまで確認なしで連続実行する**オートラン**に対応（標準停止点=方針案=Step7。PRD §7.10）。各ステップのフル分析は省略しない。

## 実行時に使うモデル（アプリが叩くモデル）
- **既定は全ステップ `claude-sonnet-4-6`**（コスト重視）。
- 中核ステップ（妥当性 S4・応答方針 S6・補正 S8/S10）は品質重要。Sonnet で不足なら設定で `claude-opus-4-8` に切替可。
- 「ステップ → モデル」を設定で一元管理し、容易に切替できるようにする。
- ※API は従量課金で Claude.ai の Max プランとは独立。

## 中核ロジックの厳守事項（PRD §11）
- **S6（応答方針）= 最重要**: 拒絶理由を覆せる（許可が得られる）範囲内で**最も広いクレーム**を狙う。引用文献の実開示と OA 主張を精査し、審査官の弱点・誤り（過大解釈・欠落要素・動機付け欠如・阻害要因・後知恵等）を突く。新規性進歩性は広狭の幅を持つ**3案以上**＋各案の根拠/権利範囲/リスク。
- **S8（補正）= 重要**: **必要最小限の追記・修正のみ**。拒絶理由解消に不要な限定を足さない（余計な補正は応答を台無しにする）。同じ解消なら最も狭めない補正を選ぶ。新規事項追加を避ける。

## 開発の進め方
- **縦の一本（vertical slice）を最優先**。UI・DB・API を別々に作り込まず、「ログイン→案件作成→アップロード→要約が返る（Step1-3）」をまず通す。横展開（残りステップ）はその後。
- フェーズ順は PRD §3 / §14 に従う（Phase0 基盤 → Phase1 MVP → Phase2 全ステップ → Phase3 任意）。
- **1タスク = 1つの動く変化**。完了ごとに動作確認 → `git commit`。Phase 完了ごとに Vercel で確認。
- 仕様が曖昧な点は実装で勝手に確定せず、**PRD §15「確認ポイント・未決事項」**を参照し、必要なら PO に確認する。
- 大きな設計判断・新規実装の前には、まず計画を提示してから着手する（Plan ファースト）。

## ディレクトリ / 重要ファイル
- `docs/PRD.md` … 要件定義の正（最優先で参照）
- `CLAUDE.md` … 本ファイル（運用ルール）
- アプリ本体は標準的な Next.js 構成（`app/`, `components/`, `lib/` 等）。`lib/` に Supabase クライアントと Claude 呼び出しのサーバー側ラッパを置く。
- `lib/env.ts` … 公開可能な環境変数（`NEXT_PUBLIC_*`）を欠落時エラー付きで取得。秘密値は置かない。
- `lib/supabase/client.ts` … ブラウザ用（anon・RLS有効）/ `server.ts` … サーバー用（async cookies）/ `admin.ts` … service_role 管理クライアント（`import "server-only"` でクライアント混入をビルド遮断）。
- `lib/database.types.ts` … Supabase から生成した `Database` 型（スキーマ変更時は再生成して差し替える）。
- `lib/anthropic/client.ts` … Claude API のサーバー専用クライアント（`import "server-only"`。`ANTHROPIC_API_KEY` はここでのみ参照）。
- `lib/config/models.ts` … 「ステップ→モデル」設定の一元管理（既定 `claude-sonnet-4-6`、中核ステップは設定で `claude-opus-4-8` に切替）。モデル名はここ経由で参照する。
- `app/api/chat/route.ts` … チャット用 Route Handler。Claude にストリーミングで往復する（認証必須）。
- `supabase/migrations/` … DB スキーマ・RLS・Storage の正（git 管理）。本番反映は Supabase MCP の `apply_migration`、同内容をこのディレクトリにも保存して二重管理する。

## コマンド
- 開発サーバー: `npm run dev`
- ビルド: `npm run build`
- Lint: `npm run lint`
> package.json と一致（確定済み）。スクリプトを追加・変更したら本セクションを更新すること。

## 環境変数（`.env.local` / Vercel に設定）
- `ANTHROPIC_API_KEY`（サーバー専用。**NEXT_PUBLIC を付けない**）
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（サーバー側のみ。クライアントに出さない）
> Supabase の API キーは**新方式を採用**: anon に publishable key（`sb_publishable_…`）、service_role に secret key（`sb_secret_…`）を入れる。legacy JWT（`eyJ…`）ではなく新方式で統一。変数名は上記のまま。

## コーディング規約
- TypeScript。`any` を避け型を付ける。
- システムプロンプト・モデル設定・各国ルールはハードコードせず定数/設定として分離（PRD §11）。
- 機密本文を含むデータは console.log で垂れ流さない。
