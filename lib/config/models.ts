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

/** 指定ステップのモデルを返す。未定義ステップは既定モデル。 */
export function modelForStep(step: StepNo): AppModel {
  return STEP_MODELS[step] ?? DEFAULT_MODEL;
}
