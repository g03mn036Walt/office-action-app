# Slice 3 ステップ2: PDF テキスト層抽出ハイブリッド（実装計画）

> 要件の正は `docs/PRD.md`。進捗トラッカーは `docs/phase1-plan.md`。本ファイルは本ステップの実行計画のみを持つ。
> ブランチ: `slice3-chat-step23`。push・マージはユーザー指示時のみ。
>
> **実行状況（2026-06-28）: 実装・lint・build・dev E2E すべて完了。** go/no-go 両条件 GREEN、案件111 で引用文献2 がテキスト層経路で完走・引用文献1（英語スキャン）は vision フォールバック・全9文書 summary 完了を Supabase MCP で確認。残=Vercel デプロイ確認・main マージ。

## Context（なぜやるか）
Slice 3 ステップ1 で解析は冪等化・並列化したが、特定 PDF が完走できない問題が実測で残る。

- 案件 `e2a69993-…`（案件名 111）の `引用文献2.pdf`＝日本語33ページ＋図13（`UniJIS-UCS2-H`・ToUnicode 無し）を現行 `analyzePdf`（vision・全文文字起こし）に通すと、入力 95,854 トークン／出力 64,000 でも収まらず生成が6分に及び `AnthropicError: terminated`（接続切断）。1リクエストでは完走不能。
- 対照の引用文献1（英語スキャン33ページ）は約1.5万トークンで完了。効くのは「画像 vs テキスト」ではなく **言語×ページ数×図＝出力トークン量**。

問題の本質は Claude に全文転写させる**出力トークン量**。テキスト層を持つ PDF は、Claude に PDF を送って文字起こしさせるのではなく **コードでテキスト層を抽出**すれば、入力9.6万トークン・巨大出力・6分の生成が丸ごと消える。抽出テキストから Claude には summary だけを生成させる（＝既存の `analyzeNonPdf` 経路に合流）。スキャン PDF（テキスト層なし／文字化け）だけ従来 vision 転写を残す。

PRD の「将来余地」が実測で必要性を裏付けた形で、コスト方針（§7.5＝PDF を毎回送らない）の趣旨にも合致する。

## ゴール
引用文献2.pdf のようなテキスト層のある大部・日本語 PDF を vision に頼らず通す。スキャン PDF のみ従来 vision に残す（回帰なし）。

## go/no-go ゲート（実装の最初に必ず実施）
最大の不確実性: pdfjs が引用文献2 の ToUnicode 無し CID フォント（`UniJIS-UCS2-H`）を **Node で正しく Unicode 抽出**できるか。これがダメならハイブリッド自体が成立しない。

### ゲート条件（**dev だけで合格としない**）
1. **抽出検証（dev）**: scratchpad スクリプトで引用文献2.pdf を pdfjs-dist（legacy build）+ cMap 設定で抽出 → 日本語が文字化けせず取れる。
   - blob 取得: Supabase MCP で `storage_path` を引き、scratchpad スクリプトで `@next/env` の `loadEnvConfig` 経由で `.env.local` を読み、`SUPABASE_SERVICE_ROLE_KEY` で Storage download（`.env` は直接 Read しない＝ガードレール）。
   - **合否の期待値**: 引用文献2 は **JP2017-33302「採材支援装置」**（平成明朝/角ゴ・UniJIS-UCS2-H）。抽出テキストに公報番号・発明名「採材支援装置」が**正しい日本語**で現れれば合格、私用領域や別字に化けるなら不合格。なお Claude は vision で正しく読める（`max_tokens=8000` で転写確認済み）ことは実測済みで、問題は出力トークン量だけ＝本ステップで回避する対象。
2. **本番バンドル検証（上記レビュー指摘1・最重要）**: 本計画の肝は ToUnicode 無し CID を `cMapUrl` で Unicode 化することだが、**Vercel サーバーレス関数は `node_modules` のデータファイル（`.bcmap` / standard_fonts）をバンドルに含めない**。dev は node_modules 直読みで通るが、本番で cmaps が無いと**同じ文字化けが再発する**（「緑→本番で再発」）。
   - 対策をコードに含める: `next.config` の `outputFileTracingIncludes` で `pdfjs-dist/cmaps/**` と（legacy build が参照するなら）`pdfjs-dist/standard_fonts/**` を該当 route 関数へ同梱する。または cmaps を安定パス（例 `public/` か `process.cwd()` 配下）へコピーして読む。
   - 合格条件に「**`npm run build` 後／プレビューデプロイでも引用文献2が化けない**」を含める。dev script 単独では合格としない。

- 2条件とも green → 本計画どおり進む。
- 抽出が化ける → ハイブリッドは断念。フォールバック=vision 経路のページ分割（pdf-lib 等で N ページずつ割り→各範囲を `analyzePdf`→`full_text` 連結）に切替。**この場合はスコープが変わるため計画を作り直してから着手**。

## アプローチ（テキスト層抽出ハイブリッド）
PDF 解析を「テキスト層抽出を試し、取れれば抽出テキスト経路・ダメなら vision 経路」の二段に分ける。抽出の置き場所は **Step2（`app/api/chat/route.ts`）側**（Step1 ではなく）。
- 既存アップロード済みファイルを救える（引用文献2 は既にアップロード済み。route 側なら次回解析時に抽出される）。
- 冪等: 一度 `summary`/`extracted_text` が入れば次回はスキップ（ステップ1の冪等化と同構造。`toAnalyze` は `summary` 未設定行のみ）。
- アップロードを軽いまま保てる。抽出処理は `lib/extract/pdfText.ts` に切り出し、将来 Step1 への前出しも容易。

### 分岐ロジック（route.ts の解析ループ、`toAnalyze` の各 PDF 1件あたり）
1. `extracted_text` が既にある → そのまま `analyzeNonPdf`（summary のみ）。【冪等・再 download 不要】
2. `extracted_text` 空 かつ `anthropic_file_id` あり（＝未抽出 PDF）→
   a. `storage_path` から Storage download
   b. `extractPdfText()` で抽出＋品質判定
   c. 品質OK → **`extracted_text` を先に保存** → `analyzeNonPdf`（summary のみ）→ summary 保存。**PDF を Claude に送らない**
      - extracted_text 先行保存により、summary 生成が落ちても次回 download+pdfjs をスキップでき冪等性が一段強い（レビュー指摘）。
   d. 品質NG（スキャン／文字化け）→ 従来 `analyzePdf`（vision）→ `extracted_text`+`summary` 保存
3. 非PDF（従来通り）→ `analyzeNonPdf`

保存内容: テキスト層経路は `extracted_text`=pdfjs結果／`summary`=Claude。vision 経路は従来通り両方 Claude。

## 変更ファイル
- **新規 `lib/extract/pdfText.ts`（`import "server-only"`）**: pdfjs-dist（legacy build）で全ページ `getTextContent` → 連結。CID フォント Unicode 化に cMap 設定が必須（`getDocument({ data, cMapUrl, cMapPacked: true, standardFontDataUrl, ... })`）。テキスト抽出のみで canvas 不要。Node では worker 無効化。正確な API は実装時に `node_modules/pdfjs-dist` の型/README で確認（AGENTS.md）。
  - `extractPdfText(blob): Promise<{ text: string; ok: boolean; reason?: string }>`。品質判定を内包:
    - 1ページ平均文字数が閾値（暫定 50字/頁）未満 → スキャン or 抽出失敗 → `ok:false`
    - 私用領域 U+E000–U+F8FF ／ U+FFFD ／ 制御文字の比率が閾値（暫定 10%）超 → 文字化け → `ok:false`
  - 機密本文はログに出さない（ガードレール7）。品質NG時も従来 vision に落ちるだけなので回帰なし（安全側）。
- **変更 `app/api/chat/route.ts`**:
  - `case_files` の select に `storage_path` を追加（現状未取得）。
  - 解析ループを上記分岐に差し替え。`supabase.storage.from(BUCKET).download(storage_path)` で本文取得。
- **新規 `lib/config/storage.ts`（レビュー指摘2・整合）**: バケット名 `CASE_FILES_BUCKET = "case-files"` を共有定数に切り出す。現状は `lib/cases/actions.ts` の `"use server"` ファイル内ローカル定数で **route から import 不可**（`"use server"` は全 export が server action 必須）。`actions.ts` と `route.ts` の双方がここを参照する。
- **変更 `lib/prompts/step2.ts`**: テキスト層抽出経路では図中文字が落ちるため、その経路向けに「図は本文テキストのみ。図面理解は後続ステップで file_id 参照」を明確化（vision 経路の文言は維持）。軽微。
- **変更 `next.config`**: 上記 go/no-go 条件2 の `outputFileTracingIncludes`（cmaps 同梱）。
- **依存追加 `pdfjs-dist`**: mammoth と同じく抽出系（OCR ではなくテキスト層抽出）。

DB スキーマ変更なし（`extracted_text`/`storage_path` は既存列）。NDJSON のイベント形（`doc_start`/`summary`/`doc_done`/`error`/`done`）は変えない → `components/app/Chat.tsx` は無改修。

## CLAUDE.md / PRD 整合
- ガードレール5「別途 OCR ライブラリは原則入れない」: pdfjs はテキスト層抽出であり OCR（画像→文字認識）ではない。スキャンは引き続き vision のまま＝原則維持。
- ガードレール3 / §7.5（コスト方針）: PDF を毎回送らず保存済みテキストを使う方針がより徹底される。図面が重要な場面は従来どおり `file_id`（保持済み）で後続参照。
- 「進む」判定・オートラン・Word は対象外（Phase 2）。

## スコープ外（後続 2b）
- vision 経路の大部分割（スキャン大部 PDF の output 肥大対策）。引用文献1は現状1.5万トークンで通るため緊急度低。テキスト層経路の効果実測後に判断。
- 本番 `maxDuration`（現状60）: テキスト層経路は download+pdfjs+summary 生成のみで軽く 60 秒に収まる見込み。vision が残るケース次第で 300 へ引き上げ検討。実測後に 2b で。

## 検証（E2E）
1. go/no-go 条件1（dev 抽出）+ 条件2（本番バンドル）の両方 green。
2. dev で再解析: 案件111 を再送 → 引用文献2 が6分切断せず数十秒で完了、summary が返る。Supabase MCP で `case_files.extracted_text`（日本語本文）/`summary` を確認。
3. 回帰: 引用文献1（英語スキャン）は品質NG判定で従来 vision 経路に落ち、従来どおり完了。非PDF（.docx 等）は無影響。
4. 冪等: 同案件を再送 → 抽出済みは再抽出・再解析されず、`messages` 重複もない。
5. `npm run lint` / `npm run build` 緑。
6. push・マージはユーザー指示時のみ。
