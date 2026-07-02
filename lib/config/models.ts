/**
 * 「ステップ → モデル」の一元管理（PRD §11 / CLAUDE.md）。
 *
 * 既定は全ステップ `claude-sonnet-4-6`（コスト重視）。
 * 中核ステップ（S4 妥当性 / S6 応答方針 / S8 補正 / S10 全文補正）は品質重要のため、
 * Sonnet で不足する場合はここを `OPUS_MODEL` に切り替えるだけで運用変更できる。
 * モデル名はハードコードせず、必ずこの定数経由で参照すること。
 */

export const SONNET_MODEL = "claude-sonnet-4-6" as const;
export const OPUS_MODEL = "claude-opus-4-8" as const;

export type AppModel = typeof SONNET_MODEL | typeof OPUS_MODEL;

/** 既定モデル（コスト重視）。 */
export const DEFAULT_MODEL: AppModel = SONNET_MODEL;

/**
 * 自由入力の意図分類（§10 / オートラン）に使う軽量モデル。
 * 出力が小さい分類タスクなので安価・高速でよい。既定は Sonnet（アカウントで検証済み）だが、
 * さらに安く/速くしたい場合はここだけ差し替える（他コードは CLASSIFIER_MODEL 経由で参照）。
 */
export const CLASSIFIER_MODEL: AppModel = SONNET_MODEL;

/** OA 検討フローの全ステップ番号（1..14）。 */
export type StepNo =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7
  | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/**
 * ステップ番号 → 使用モデル。
 * 現状は全ステップ Sonnet。中核ステップ（4/6/8/10）を Opus にしたい場合は
 * 該当エントリを `OPUS_MODEL` に変更する（他コードの修正不要）。
 */
export const STEP_MODELS: Record<StepNo, AppModel> = {
  1: SONNET_MODEL,
  2: SONNET_MODEL,
  3: SONNET_MODEL,
  4: SONNET_MODEL, // ★中核: 妥当性評価
  5: SONNET_MODEL,
  6: SONNET_MODEL, // ★中核: 応答方針
  7: SONNET_MODEL,
  8: SONNET_MODEL, // ★中核: 補正
  9: SONNET_MODEL,
  10: SONNET_MODEL, // ★中核: 全文補正
  11: SONNET_MODEL,
  12: SONNET_MODEL,
  13: SONNET_MODEL,
  14: SONNET_MODEL,
};

/**
 * 実行時のモデル選択（UI のモデルピッカー由来）。sonnet=標準 / opus=高品質。
 * 送信リクエスト単位で指定され、そのリクエストで実行されるステップに適用される（永続化しない）。
 * クライアント（ピッカー）とサーバー（run*）で共有する型（秘密値ではない）。
 */
export type ModelPref = "sonnet" | "opus";

/**
 * ステップ実行関数（run* / runAnalysis）に渡す呼び出しオプション。
 * cache: オートラン継続時のみ true（§7.5）。model: UI ピッカーの選択（未指定は STEP_MODELS の既定）。
 */
export type StepCallOptions = {
  cache?: boolean;
  model?: ModelPref;
};

/**
 * 指定ステップのモデルを返す。pref（UI ピッカーの選択）があればそれを優先し、
 * 無ければ STEP_MODELS の既定（現状すべて Sonnet）。未定義ステップは既定モデル。
 */
export function modelForStep(step: StepNo, pref?: ModelPref): AppModel {
  if (pref === "opus") return OPUS_MODEL;
  if (pref === "sonnet") return SONNET_MODEL;
  return STEP_MODELS[step] ?? DEFAULT_MODEL;
}
