# Phase 1 実装プラン / 進捗トラッカー

> 要件の正は **`docs/PRD.md`**。本ファイルは**実行計画（スライス分割・ファイル・確認手順）と進捗**だけを持つ。要件本文はコピーせず PRD の §番号で参照する。

## ゴール
「ログイン → 案件新規作成 → 本願/OA/引用/現クレームをアップロード → Step2-3 で全文テキスト化＋要約がチャットに返り DB に残る」という縦の一本を成立させる。案件 CRUD とアプリシェルを含む。Step4 以降・オートラン・Word 出力は Phase 2 以降。
- 要件: PRD §3 / §14 タスク5-7、受け入れ基準: PRD §16

## 現在地
- [x] Phase 0（基盤）完了 — DB 全テーブル+RLS+Storage、Supabase 3 クライアント、認証（login/callback/signout/requireUser）、Anthropic サーバークライアント、`lib/config/models.ts`、疎通用 `app/api/chat/route.ts`、デザイントークン（`globals.css @theme`）+ Brandmark + login 画面
- [x] Slice 1 — アプリシェル + 案件 CRUD（削除に確認ダイアログ追加済み）
- [ ] Slice 2 — ファイルアップロード + Files API（Step1）
- [ ] Slice 3 — チャット + Step2-3（縦の一本完成）→ Vercel デプロイ確認

## 進め方の原則（詳細は CLAUDE.md / PRD §14）
- 1 タスク = 1 つの動く変化。スライス完了ごとに動作確認 → `git commit`。Phase 1 完了で Vercel 確認。
- DB スキーマは Phase 0 で定義済み。変更が要る場合のみ `supabase/migrations/` に追加 → Supabase MCP `apply_migration` で反映 → 同内容をディレクトリにも保存（二重管理）。
- Next.js 16 は破壊的変更あり。実装前に該当 API を `node_modules/next/dist/docs/` で確認（AGENTS.md）。
- Server Action / Route Handler は先頭で `requireUser`（`lib/supabase/session.ts`）。API キー・機密本文をクライアント/ログに出さない。
- 本セッションで確定した前提:
  - ファイル形式は最初から PDF + .docx/.txt/.md 対応。PDF は Claude ネイティブ、.docx/.txt/.md/.csv はサーバー側抽出（.docx は mammoth）（CLAUDE.md ガードレール5、PRD §7.3）。
  - UI の正は Claude Design（`office-action-app-ui`、projectId `0e0eabb0-9f93-49db-a071-619cc988ef28`）。各画面 handoff → `/design-sync` で `get_file` → React/Tailwind に翻訳して `components/` に実装。未 handoff なら当該スライスでトークンベースの素朴 UI を先行させ後追いで差し替え。

---

## Slice 1: アプリシェル + 案件 CRUD
ねらい: 「ログイン → 案件作成 → 一覧 → 再開 → 削除 → お気に入り」が動く土台。

主な新規/変更ファイル:
- `app/(app)/layout.tsx` … 2 カラム（左サイドバー固定 + 右メイン、固定ヘッダ）
- `app/page.tsx` … 現状の仮トップをシェルへ置換
- `app/(app)/case/[id]/page.tsx` … 案件再開（この時点は案件ヘッダ + 空メインで可）
- `components/Sidebar.tsx` / `components/CaseList.tsx` … 案件一覧（お気に入り上部 PRD §9.2）、新規作成、三点メニュー（削除 / お気に入り切替）
- `app/(app)/actions.ts`（または `lib/cases/actions.ts`）… 案件 CRUD の Server Actions（作成 insert / 削除 cascade / お気に入りトグル）。すべて `requireUser` 経由・owner 限定（RLS が二重防御）

確認:
- [x] `npm run dev` で CRUD 一連（local:3000 で作成/一覧/再開/削除/お気に入りを確認）
- [x] `npm run build` / `npm run lint`（グリーン）
- [x] Supabase MCP `execute_sql` で `cases` スキーマ整合を確認
- [x] `git commit`

## Slice 2: ファイルアップロード + Files API（Step1）
ねらい: 4 種別の文書を保存し、PDF を Files API に載せて `file_id` を持つ。

主な新規/変更ファイル:
- `lib/anthropic/files.ts` … Files API の upload/delete ラッパ。beta ヘッダ `files-api-2025-04-14` 必須（CLAUDE.md ガードレール4、PRD §7.4）。`getAnthropic()` 再利用
- `lib/config/docRoles.ts` … doc_role（applicant/oa/reference/claims）の定義・ラベル
- `lib/extract/text.ts` … .docx=mammoth、.txt/.md/.csv=デコードのみ（PDF はここで抽出しない＝Claude ネイティブ）
- `components/FileUpload.tsx` … 4 種別の D&D/ボタン受付、公報番号・対象国（JP/US/EP/WO/CN）入力
- アップロード処理（Server Action or Route）… Storage `{user_id}/{case_id}/{filename}` 保存 → PDF は Files API へ → `case_files.anthropic_file_id` 保存 → `case_files` レコード作成 → `cases.publication_number/country/title` 更新
- 案件削除の拡張 … 削除時に各 `anthropic_file_id` を Files API DELETE（CLAUDE.md ガードレール4）
- 依存追加: `mammoth`（npm install）

確認:
- [ ] アップロード後 Storage / `case_files` 行 / `anthropic_file_id` を MCP 確認
- [ ] 削除で Storage と Files API が消える
- [ ] `npm run build` / `npm run lint`
- [ ] `git commit`

## Slice 3: チャット + Step2-3（解析・テキスト化・要約）★縦の一本完成
ねらい: 送信すると各文書の全文テキスト化＋概要がストリーミング表示され DB に残る。

主な新規/変更ファイル:
- `lib/prompts/step2.ts` … PRD §11-S2 のシステムプロンプト（全文テキスト化＋各文書の概要）。ハードコードせず定数分離
- `components/ChatMessages.tsx` … messages を時系列表示
- `components/ChatInput.tsx` … テキスト入力 + 送信、固定配置（PRD §9）
- `app/api/chat/route.ts` … 疎通用から本実装へ拡張
  - コンテキスト組み立て: S2 プロンプト + 文書。PDF は `file_id`（document ブロック）、.docx/.txt/.md は `lib/extract/text.ts` の抽出テキストを本文に含める（PRD §7.3）
  - `modelForStep(2)` でモデル選択し `stream: true`、サーバー→クライアントへ逐次転送
  - 完了後（Step3 相当）: 出力から全文テキスト/概要を取り出し `case_files.extracted_text`/`summary` 更新、`messages` に user/assistant 保存、`cases.current_step` 更新
- 「進む」判定は最小実装（次の 1 ステップを進める自由入力）。オートラン（§7.10）は Phase 2

確認:
- [ ] アップロード→送信で要約がストリーミング表示、リロードで残る（`messages` / `extracted_text` を MCP 確認）
- [ ] `npm run build` / `npm run lint`
- [ ] `git commit` → Vercel 本番（office-action-app.vercel.app）でログイン〜要約まで通し確認

---

## 留意・未決
- Claude Design 側に各画面（シェル/サイドバー/アップロード/チャット）が handoff 済みか要確認。
- オートラン停止点の指定 UI（PRD §15 残課題）は Phase 1 では扱わない。
- docx（Word 生成）は Phase 2 で導入。Phase 1 では入れない。
