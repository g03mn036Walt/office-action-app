/**
 * 全14ステップの表示用ラベル（PRD §10/§11 の検討フロー）。
 * サイドバーの案件メタ行やヘッダのステップ表示に使う。表示専用で、
 * 中核ロジック（モデル選択など）は lib/config/models.ts 側で管理する。
 */
export const STEP_LABELS: Record<number, string> = {
  1: "アップロード",
  2: "文書解析",
  3: "文書理解",
  4: "妥当性評価",
  5: "妥当性評価",
  6: "応答方針",
  7: "応答方針",
  8: "補正案",
  9: "補正案",
  10: "全文補正",
  11: "全文補正",
  12: "意見書",
  13: "意見書",
  14: "Word 出力",
};

/** 指定ステップの表示ラベルを返す（未定義は空文字）。 */
export function stepLabel(step: number): string {
  return STEP_LABELS[step] ?? "";
}
