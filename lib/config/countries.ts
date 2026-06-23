/**
 * 対象国（PRD §15-4 / CLAUDE.md）。
 * 補正・主張は各国ルールを考慮するため、国コードは定数として一元管理する。
 */
export const COUNTRIES = ["JP", "US", "EP", "WO", "CN"] as const;

export type Country = (typeof COUNTRIES)[number];
