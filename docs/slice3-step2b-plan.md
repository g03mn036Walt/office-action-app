# Slice 3 ステップ2b: vision 大部スキャンの1頁分割転写

> 親（2a 設計）: `docs/slice3-step2-plan.md` / 進捗: `docs/phase1-plan.md` / 要件: `docs/PRD.md` §7.5。
> 本ファイルは 2b（vision 経路の大部スキャン対応）の設計・実測・確定事項の正。

## 解いた問題
テキスト層を持たないスキャン PDF は 2a の品質判定で `ok:false` となり vision 文字起こしに回る。旧実装（単一
`analyzePdf`：1回の vision 呼び出しで `full_text`＋`summary`、`max_tokens=64000`）は大部スキャンで2つの問題を起こす:
1. **タイムアウト**: 生成時間が本番 Vercel(Hobby) の `maxDuration=60s` を超え関数が打ち切られる。途中保存が無いため
   `summary` 未保存→`current_step` 据え置き、再送のたびにフル転写をやり直し永久に未完。
2. **取りこぼし（正確性）**: 出力長プレッシャーで密な頁を黙って圧縮する。引用文献1（英語スキャン32頁）で
   単一呼び出し ≈59,715字に対し、1頁分割では ≈105,191字（約4割を落としていた）。

## 確定事項（dev 実測 2026-06-28）
- 本番プラン = **Hobby（maxDuration 上限 60s）**。60 超指定はデプロイ失敗 → **`maxDuration=60` 据え置き**（300 へは上げられない）。
- 1ストリームの出力は ~40 tok/s で固定。並列を増やすとアグリゲートは伸びる（16並列=277／32並列=545 tok/s）＝アカウント OTPM 律速ではない。
- チャンクサイズ別実測（引用文献1=32頁）: 6頁/6並列=221.8s(NG)・2頁/16並列=83.0s・**1頁/32並列=45.4s（採用）**。
  密な1頁は ~1,500トークン・~45s で必ず 60s 未満に収まる。
- 既知の限界: 単一スキャンfileが ~32頁を大きく超えて一様に密だと単一ウェーブ（並列度＝ページ数）が 60s を超えうる。
  その極端ケースのみ将来「ファイル内ページ永続化（再送跨ぎ再開）」へ拡張。

## 設計（最小・migration なし）
- **新規 `lib/extract/pdfSplit.ts`**: `splitPdfByPages(blob, pagesPerChunk=1)` を `pdf-lib` で実装（描画なし＝OCR ではなく
  物理分割。pdf-lib は純 JS でそのままバンドルでき `next.config.ts` 変更不要）。
- **新規 `lib/anthropic/visionPdf.ts`**: `transcribePdfByPages(blob, role, fileName)`。1頁チャンクを Files API へ並列
  upload（`uploadPdf` 再利用）→ `full_text` のみの構造化出力で並列度 ~32（単一ウェーブ）転写 → ページ順連結 → チャンク
  `file_id` を best-effort 削除。一時エラー（過負荷529/429/5xx/接続）は**チャンク単位で指数バックオフ・リトライ**
  （32並列バーストで単発 `overloaded_error` が起きやすく、無リトライだと1チャンクの一時失敗でファイル全体がやり直しになる）。
- **変更 `app/api/chat/route.ts`**: vision 分岐（`extracted.ok===false`）の単一 `analyzePdf` を `transcribePdfByPages`
  （download 済み blob を再利用）へ差し替え。連結 `full_text` を**先に `extracted_text` 保存**→ **ソフト締切ガード**
  （`SUMMARY_DEADLINE_MS=35s`）で、転写に時間を使った場合は要約を再送1回に先送り（`{t:"info"}` で中立案内＋`done ok=false`）、
  小さいスキャンは inline 要約で1回完了。旧 `analyzePdf`/`PDF_SCHEMA`/`FILES_API_BETA` は削除（`analyzeNonPdf`/`guardStop`/
  `parseAnalysis`/`SUMMARY_SCHEMA` は維持）。
- **変更 `components/app/Chat.tsx`**: NDJSON に `{t:"info"}` を1ケース追加（要約先送りの中立バナー。エラー色でない）。
- **依存 `pdf-lib`**（^1.17.1）。DB スキーマ変更なし（`extracted_text`/`summary`/`storage_path` は既存列）。

## 冪等性・完了/再送フロー
1. 1送信目: スキャンfile → 1頁分割並列転写（~46s）→ `extracted_text` 先行保存 → 経過 > 締切なら要約を先送り（`info`・`done ok=false`）。
2. 2送信目: 当該fileは `extracted_text` あり → `analyzeNonPdf` 直行（~20s）で `summary` 生成 → 全件揃えば `messages` 保存・
   `current_step=3` → `done ok=true` → `router.refresh`。
- 既存の冪等（summary 済みは再解析せず）・`step_no=3` 既存なら messages 重複防止・`Promise.allSettled` で他文書継続、は不変。

## 検証
- **go/no-go（dev 実測）**: 1頁/32並列で transcribe 45.4s・aggregate 545 tok/s・429 なし・full_text 100,409字・badChars0。GREEN。
- **dev E2E（実データ・c57f3ccb 引用文献1）**: route の vision 分岐を実 DB に対し再現実行 → `extracted_text` 105,191字
  （badChars0・head/tail 正常）＋`summary` 1,077字を保存。Supabase MCP で当該行と案件内全5文書の summary 充足を確認。
- `npm run lint` / `npm run build`（TypeScript）緑。`maxDuration=60` 据え置きでデプロイ安全。
- ライブ・ルート確認（認証必須・ユーザー操作）: 案件で送信し、完了系（messages・`current_step=3`）と UI 表示を確認。

## スコープ・回帰
- テキスト層経路（2a）・分岐ロジック・`lib/extract/pdfText.ts`・`next.config.ts` の pdfjs tracing は不変（回帰なし）。
- 既に転写済みの他案件スキャン文献（例 案件111 引用文献1=59,715字）も同様に取りこぼしているため、2b 後に再転写すると正確性が上がる（別途）。
