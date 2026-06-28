# Phase 1 実装プラン / 進捗トラッカー

> 要件の正は **`docs/PRD.md`**。本ファイルは**実行計画（スライス分割・ファイル・確認手順）と進捗**だけを持つ。要件本文はコピーせず PRD の §番号で参照する。

## ゴール
「ログイン → 案件新規作成 → 本願/OA/引用/現クレームをアップロード → Step2-3 で全文テキスト化＋要約がチャットに返り DB に残る」という縦の一本を成立させる。案件 CRUD とアプリシェルを含む。Step4 以降・オートラン・Word 出力は Phase 2 以降。
- 要件: PRD §3 / §14 タスク5-7、受け入れ基準: PRD §16

## 現在地
- [x] Phase 0（基盤）完了 — DB 全テーブル+RLS+Storage、Supabase 3 クライアント、認証（login/callback/signout/requireUser）、Anthropic サーバークライアント、`lib/config/models.ts`、疎通用 `app/api/chat/route.ts`、デザイントークン（`globals.css @theme`）+ Brandmark + login 画面
- [x] Slice 1 — アプリシェル + 案件 CRUD（削除に確認ダイアログ追加済み）
- [x] Slice 2 — ファイルアップロード + Files API（Step1）※PR #1（`6c3a058`）で main にマージ済み。Storage キーは日本語名対策で `{uuid}.{ext}`（原名は `file_name` に保持）
- [x] Slice 3 — チャット + Step2-3（縦の一本完成）。Step1=冪等化・並列化・完了判定（`576debf`）／Step2=PDFテキスト層抽出ハイブリッド。dev E2E（案件111・Supabase MCP）PASS。`slice3-chat-step23` 上。**残=Vercel デプロイ確認・main マージ**

## 進め方の原則（詳細は CLAUDE.md / PRD §14）
- 1 タスク = 1 つの動く変化。スライス完了ごとに動作確認 → `git commit`。Phase 1 完了で Vercel 確認。
- ブランチは必ず**最新 main を起点**に切る。古いコミットから分岐すると既マージ済みの作業を退行させる（Slice 3 で実際に発生＝古い `FileUpload.tsx` を含む土台。Slice 3 コミット単独を main へ cherry-pick して復旧）。
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
ねらい: 4 種別の文書を保存し、PDF を Files API に載せて `file_id` を持つ。複数ファイル（OA 複数回・引用文献複数・過去補正書/意見書）を扱える。

### 経路（確定）: クライアント直 Storage → サーバーで Files API
- クライアント（`lib/supabase/client.ts`）が `case-files` に直 put（path = `{user_id}/{case_id}/{filename}`）。Storage RLS（migration 0003: `foldername(name)[1] == auth.uid()`）が owner 限定を担保。Server Action の bodySizeLimit（既定 1MB）を回避し大きい特許 PDF・100ページ超に耐える。
- 完了後、path・doc_role・file_name・file_type を Server Action `registerUploadedFile` に渡す。
- サーバー（`lib/supabase/server.ts`＝RLS下）が Storage から download し:
  - PDF → `lib/anthropic/files.ts` で Files API upload（beta ヘッダ `files-api-2025-04-14`）→ `anthropic_file_id` 保存。抽出はしない（Claude ネイティブ読込／全文化は Slice 3 の Step2）。
  - .docx/.txt/.md/.csv → `lib/extract/text.ts` で抽出 → `extracted_text` 保存（Files API には載せない＝コスト方針 CLAUDE.md ガードレール5）。
- **クリーンアップ順序**: Files API upload／抽出が成功してから `case_files` 行を insert。失敗時は直前に put した Storage オブジェクトを `remove` し孤児を残さない。`admin.ts` は使わない（RLS 原則維持）。

### doc_role と多重度（PRD §236 の4語彙を維持。補正書/意見書は claims に格納し新 role は増やさない）
| doc_role | ラベル | 多重度 |
|---|---|---|
| `applicant` | 本願明細書 | **1件のみ**（既存があれば UI で追加不可。差し替えは削除→再アップロード） |
| `oa` | OA（拒絶理由） | 複数可（時系列で複数回） |
| `reference` | 引用文献 | 複数可 |
| `claims` | 現クレーム（過去の補正書・意見書を含む） | 複数可 |

複数管理のため**個別ファイル削除**（`deleteFile`）を用意する。

主な新規/変更ファイル:
- `lib/anthropic/files.ts` … Files API の upload/delete ラッパ。`getAnthropic()` 再利用、beta ヘッダ。Supabase の `Blob` → SDK file 変換（`toFile`）。シグネチャは着手時に `/claude-api` で確認（CLAUDE.md ガードレール4、PRD §7.4）
- `lib/config/docRoles.ts` … doc_role 定義・ラベル・多重度（`applicant` のみ単一）・受理拡張子。doc_role 語彙の単一の正
- `lib/extract/text.ts` … .docx=mammoth、.txt/.md/.csv=デコードのみ（PDF はここで抽出しない＝Claude ネイティブ）。抽出分岐は `file_name` の拡張子で判定（ブラウザ MIME は不正確なことがあるため）。`file_type` には MIME を保存
- `components/app/FileUpload.tsx` … 役割ごとのリスト形式 UI（`applicant` は1件、`oa`/`reference`/`claims` は追加可）。ブラウザ直アップロード → `registerUploadedFile` 呼び出し。既存規約に合わせ `components/app/` に置く
- `lib/cases/actions.ts`:
  - `registerUploadedFile` 追加 … メタ受領 → download → PDF は Files API／他は抽出 → `case_files` insert（上記クリーンアップ順序）→ `revalidatePath`。`applicant` は insert 前に既存行があれば拒否（UI 側でも追加抑止）
  - `deleteFile` 追加 … 個別ファイル削除（Storage `remove` + Files API DELETE + `case_files` 行削除）
  - `deleteCase` 拡張 … 削除前に当該 case の `storage_path`／`anthropic_file_id` を全取得 → Storage `remove`（複数パス）+ 各 `anthropic_file_id` を Files API DELETE → `cases` 行削除（Storage は FK cascade 対象外のため明示削除が必須）
- `components/app/NewCaseModal.tsx` … プレースホルダ文書 grid を撤去し公報番号/対象国のみに簡素化（アップロードは案件ビューへ。パスが `case_id` を要求し作成前は配置できないため。NewCase.dc.html とは乖離 → 再 handoff は後追い）
- `app/(app)/case/[id]/page.tsx` … `case_files` を役割別に取得・表示し `FileUpload` を配線
- 依存追加: `mammoth`（npm install）

着手単位:
- **2a 基盤** ✅ 実装済み（build/lint 緑。実アップロード/DB の確認はローカル）: `mammoth` 追加 / `docRoles.ts` / `extract/text.ts` / `anthropic/files.ts` / `actions.ts` に `registerUploadedFile`・`deleteFile` 追加＋`deleteCase` 拡張
- **2b UI 配線** ✅ 実装済み（build/lint 緑。実アップロード/DB の E2E 確認はローカル）: `case/[id]/page.tsx` の役割別表示、`FileUpload.tsx`（ブラウザ直 put → `registerUploadedFile`）、`DeleteFileButton.tsx`（個別削除）、`NewCaseModal` 簡素化

確認:
- [ ] `applicant` は2件目を追加不可、`oa`/`reference`/`claims` は複数行が入る
- [ ] アップロード後 Storage / `case_files` 行 / `anthropic_file_id`（PDF のみ）を MCP 確認
- [ ] 個別ファイル削除で Storage と Files API が消える
- [ ] 案件削除で当該 case の全ファイルの Storage と Files API が消える
- [x] `npm run build` / `npm run lint`（2a/2b 実装後に緑）
- [x] `git commit`（2b 実装）

## Slice 3: チャット + Step2-3（解析・テキスト化・要約）★縦の一本完成
ねらい: 送信すると各文書の全文テキスト化＋概要がストリーミング表示され DB に残る。

主な新規/変更ファイル:
- `lib/prompts/step2.ts` … PRD §11-S2 のシステムプロンプト（全文テキスト化＋各文書の概要）。ハードコードせず定数分離
- `components/app/ChatMessages.tsx` … messages を時系列表示（既存規約に合わせ `components/app/`）
- `components/app/ChatInput.tsx` … テキスト入力 + 送信、固定配置（PRD §9）
- `components/app/Chat.tsx` … 送信→`/api/chat` POST→NDJSON 読取の状態管理ラッパ（文書 UI を children に内包）
- `app/api/chat/route.ts` … 疎通用から本実装へ拡張
  - **文書ごとに個別呼び出し**（DOC_ROLES 順）。PDF は `file_id`（document ブロック、`files-api-2025-04-14`）、非PDF は保存済み抽出テキストを本文に含める（PRD §7.3）
  - `modelForStep(2)`（Sonnet 4.6）+ **構造化出力 `output_config.format`** で `{summary, full_text}` を取得（PDF は streaming/`finalMessage`、非PDF は summary のみ）。進捗は NDJSON で逐次転送
  - 完了後（Step3 相当）: PDF は `extracted_text`/`summary`、非PDF は `summary` のみ更新（既存抽出は保持）。`messages` に user/assistant 保存、`cases.current_step=3`
- 「進む」判定は最小実装（次の 1 ステップを進める自由入力）。オートラン（§7.10）は Phase 2

### Step1 / Step2 追補（Slice 3 を E2E まで到達）
- **Step1（`576debf`）**: 再解析の冪等化（`summary` 未設定行のみ解析）＋`Promise.allSettled` 並列化＋完了判定（全件揃った初回のみ `messages` 保存・`step_no=3` 既存なら重複防止）。下の Phase2 申し送り「再解析の冪等性なし」を解消。
- **Step2: PDFテキスト層抽出ハイブリッド**（設計の正 `docs/slice3-step2-plan.md`）: テキスト層を持つ PDF は `lib/extract/pdfText.ts`（pdfjs-dist v6 legacy + cMap）でコード抽出し Claude には summary のみ生成（`analyzeNonPdf` 合流）、スキャン/文字化けのみ従来 vision（`analyzePdf`）。`app/api/chat/route.ts` は `extracted_text` 優先 → 未抽出 PDF は `storage_path` で download → `extractPdfText`（品質 ok で `extracted_text` 先行保存）。新規 `lib/config/storage.ts`（`CASE_FILES_BUCKET` 集約）、`next.config.ts` に `serverExternalPackages:["pdfjs-dist"]`＋`outputFileTracingIncludes`（cmaps/standard_fonts を `/api/chat` へ同梱）。動機=大型和文 PDF（引用文献2: UniJIS-UCS2-H・33頁）の vision 全文転写が出力トークン爆発で6分・接続切断する問題。E2E で当該文書が vision なし完走、英語スキャン（引用文献1）は vision フォールバックを確認。

確認:
- [x] アップロード→送信で要約が表示、リロードで残る（案件111 で dev E2E。`messages`／`extracted_text` を Supabase MCP 確認: 全9文書 summary 完了・user/assistant 各1で重複なし）
- [x] `npm run lint`（緑）／ `npm run build`（型チェック緑。ページデータ収集は env 前提）
- [x] `git commit`（main 起点 `slice3-chat-step23`、PR 作成）／ [ ] Vercel 本番（office-action-app.vercel.app）でログイン〜要約まで通し確認

---

## 留意・未決
- Claude Design 側に各画面（シェル/サイドバー/アップロード/チャット）が handoff 済みか要確認。
- オートラン停止点の指定 UI（PRD §15 残課題）は Phase 1 では扱わない。
- docx（Word 生成）は Phase 2 で導入。Phase 1 では入れない。

### Phase 2 申し送り（Slice 3 レビューで検出。機能はするが要改善）
- ~~**再解析の冪等性なし**~~ → **Slice3 Step1（`576debf`）で解消**: `summary` 未設定行のみ解析・`step_no=3` 既存なら `messages` 追記しない。さらに Step2 で PDF を毎回フル文字起こしせずテキスト層抽出に置換し §7.5 にも整合。
- **`maxDuration=60`（`app/api/chat/route.ts`）**: Step2 でテキスト層 PDF は download+pdfjs+summary のみで軽くなったが、スキャン大型 PDF が複数 vision に回る案件ではタイムアウトの恐れ。vision 大部のページ分割と併せ 300 への引き上げを 2b/Phase2 で検討。
- ~~**構造化出力 × Files API の併用は未実機検証**~~ → **E2E 確認済み**: 引用文献1（英語スキャン）が vision 経路（`analyzePdf`=`output_config.format` + Files API document ブロック）で summary/full_text を生成・保存できた。
