# Phase 2 実行計画: 検討フロー全ステップ（Step4-14＋オートラン＋Word）

> 要件の正は `docs/PRD.md`（§3/§7.10/§8/§10/§11/§14）。運用ルールは `CLAUDE.md`。
> 本ファイルは Phase 2 の実行計画（自己完結）。Phase 1 の進捗トラッカーは `docs/phase1-plan.md`。
> ブランチ: `phase2-steps`（最新 main 起点）。push・マージはユーザー指示時のみ。

## Context（なぜ・何を）
Phase 1（Slice3 Step2a まで）で「ログイン→案件作成→アップロード→Step2-3 解析・全文テキスト化・要約」の縦の一本が本番で通った。Phase 2 は残りの検討フロー Step4-14（妥当性評価→応答方針→代表補正→全文補正→意見書→Word 出力）とオートラン（§7.10）を実装する。

### 並行開発と唯一の衝突点
- **唯一の衝突点 = `app/api/chat/route.ts` の POST 関数。** Step2b（vision 大部スキャンのページ分割＋maxDuration）と Phase2（POST のステップ・ディスパッチャ化）が同じ関数を奪い合う。
- route.ts の編集領域は 2 つ:
  - **ゾーンA（Step2-3 解析パス）= 2b が所有**: `maxDuration`（行27）、`analyzePdf`(vision, 行93-125)、vision 分岐（行311-324）、解析ループ本体（行235-403）。
  - **ゾーンB（POST 制御フロー/ディスパッチ）= Phase2 が触る**: 現状ディスパッチは無く常にゾーンAを実行。
- **回避策（合意済み 2026-06-28）**:
  1. 2b は専用ブランチで route.ts を所有し**先にマージ**。
  2. Phase2 は本ブランチで **route.ts 非依存部のみ**を先行実装（Track A）。**route.ts は一切触らない・包まない・インデントを変えない。**
  3. route.ts ディスパッチャ化＋オートラン（Track B）は **2b マージ後に直列**。
- 一時エンドポイントは**作らない**。Track A の検証は scratchpad スクリプトで行い、UI 経由の最終 E2E は Track B 結線後（2b マージ後）に実施。

### 前提（確認済みの事実・計画を単純化する）
- `case_artifacts` テーブルは既存（`kind` enum: summary/validity/strategies/rep_amendment/full_amendment/opinion/docx、`payload jsonb`）→ **Phase2 のマイグレーション不要**。
- `lib/config/models.ts` は全14ステップ定義済み（既定 Sonnet、中核 S4/6/8/10 は設定で Opus 切替可）→ **変更不要、必ずこの定数経由で参照**。
- `lib/config/steps.ts` ラベルも完備 → 変更不要。
- `components/app/Chat.tsx` は 2b が触らない（NDJSON イベント形を変えない）→ **本ブランチで並行編集して安全**。
- 既存パターンの参照元: `app/api/chat/route.ts`（構造化出力スキーマ・guardStop・stream・NDJSON 送信）、`lib/prompts/step2.ts`（プロンプト定数の書式）。

### 論理依存
Step4+ は全文書の `extracted_text` を送る前提（PRD §7.5、原本 PDF は毎回送らない）。大型和文スキャン（案件111 引用文献2 等）の本番完走は 2b に依存するが、**Track A の部品開発・検証は extracted_text 充足済み案件（111 / c57f3ccb）で並行可能**。

## Track A（本ブランチ・route.ts 非依存・並行可）
着手順は縦の薄いスライス優先。**まず S4-S5 妥当性を1本通してから** S6-14 を横展開する。

### 手順1: 基盤
- **`lib/chat/events.ts`**: チャットイベント契約を集約。Step4+ 用に追加するイベント:
  - `text_delta`（逐次本文）/ `artifact`（validity/strategies/amendment 等の構造化 payload）/ `step_done`（current_step 通知）/ `error` / `done` / オートラン用 `autorun_advance`。
  - 既存 doc系（`doc_start`/`summary`/`doc_done`）は温存（後で Chat.tsx の union と統合）。
- **`lib/context/buildContext.ts`**: 案件の `case_files.extracted_text`/`summary` ＋ `messages`（時系列）から Claude へ送るコンテキストを組む純関数。原本 PDF は送らない（§7.5）。図面が重要な場面のみ後続で `file_id` 参照。
- **`lib/steps/schemas.ts`**: 各ステップの構造化出力スキーマ（object は `additionalProperties:false`＋`required` 必須。route.ts の `PDF_SCHEMA` と同流儀）。妥当性チャート（請求項×文節×引用文献の5段階）など。
- **`lib/steps/persist.ts`**: `messages`(step_no/content) ＋ `case_artifacts`(kind/payload) 保存ヘルパ。機密本文はログに出さない（ガードレール7）。

### 手順2: S4-S5 縦スライス（妥当性評価）
- **`lib/prompts/step4.ts`**（`import "server-only"`、PRD §11-S4 厳守: 構成要件分解×引用文献の5段階評価、審査官の弱点・誤り〔過大解釈/欠落要素/動機付け欠如/阻害要因/後知恵〕の能動特定）。
- **`lib/steps/runValidity.ts`**: `getAnthropic`＋`modelForStep(4)`＋`buildContext`＋step4 プロンプト＋構造化出力で stream を返すサーバー関数。route.ts は後でこれを呼ぶだけ。
- **`components/app/ValidityChart.tsx`**: 5段階妥当性チャート（PRD §9.4）。globals.css トークン＋`components/ui` から組む。
- **検証**: scratchpad の node スクリプトで、extracted_text 充足済み案件（111 / c57f3ccb）に runValidity を実行→スキーマ適合とチャート描画を確認（route.ts も一時エンドポイントも不要）。

### 手順3: 横展開（S6-S14）
- **プロンプト**: `lib/prompts/step{6,8,10,12,14}.ts`。**S6（応答方針）= 最重要**（許可範囲内で最も広いクレーム・新規性進歩性は3案以上＋各案の根拠/権利範囲/リスク、§11-S6 厳守）。**S8（補正）= 重要**（必要最小限の追記・修正のみ、新規事項追加回避、§11-S8 厳守）。
- **実行関数**: `lib/steps/runStrategy.ts`(S6)/`runAmendment.ts`(S8/S10)/`runOpinion.ts`(S12)/`runDocx.ts`(S14)。
- **UI**: `components/app/AmendmentDiff.tsx`（補正箇所ハイライト）/`DocxDownload.tsx`（署名 URL DL）。
- **Word 生成**: `lib/docx/build.ts`。Claude には構造化テキストを出させ、`docx` で各国（JP/US/EP/WO/CN）フォーマットの補正書・意見書・見解書を生成→Storage 保存→署名 URL（ガードレール6）。
- **`components/app/Chat.tsx`**: 新イベント（`text_delta` 等）の逐次テキスト描画を追加。

## Track B（2b マージ後・直列）
本ブランチでは着手しない。2b マージ後に別途実施:
1. route.ts のゾーンA（2b 最終形）を `lib/steps/runAnalysis.ts` へ抽出。
2. POST を薄いディスパッチャ化: 認証・案件確認の後、ユーザー入力意図＋`current_step` を解釈し (a)次1ステップ (b)指定ステップまで=オートラン (c)現ステップ追問 を判定（PRD §10「進む」判定・§7.10）。各ステップは Track A の run* を呼ぶ。
3. オートラン・オーケストレータ: Step2→4→6 を順に実行・逐次保存・ストリーム（標準停止点 = S7 応答方針）。連続実行時のみプロンプトキャッシュ可（ガードレール3）。エラー時は失敗ステップで停止し再開可能に。

## 衝突回避の鉄則（Track A 実装中）
- route.ts のゾーンA（行27 / 93-125 / 311-324 / 235-403）を**触らない・関数で包まない・インデントを変えない**。2b の差分がクリーンに当たる状態を保つ。
- Phase2 の追記は新規ファイルに閉じる。route.ts への結線は Track B（2b マージ後）でのみ行う。

## CLAUDE.md / PRD 整合
- モデルは `lib/config/models.ts` 経由のみ（ハードコード禁止）。システムプロンプト・各国ルールは定数/設定に分離（§11）。
- API キーはサーバー側のみ（`lib/anthropic/client.ts`、server-only）。RLS で owner 限定（route と同じ二重防御）。
- 機密本文（extracted_text/summary/補正案等）を console.log で垂れ流さない。
- ストリーミングで逐次表示（§7.9）。

## 検証（全体）
1. Track A 各実行関数を scratchpad スクリプトで extracted_text 充足案件に対し実行し、構造化出力スキーマ適合を確認。
2. UI コンポーネント（チャート/ハイライト/DL）は実 payload で描画確認。
3. `npm run lint` / `npm run build` 緑を各まとまりで確認。
4. UI 経由の最終 E2E は Track B 結線後（2b マージ後）。
5. push・マージはユーザー指示時のみ。

## 進捗
- 2026-06-28: 計画確定・`phase2-steps` ブランチ作成・Track A 手順1 着手。
