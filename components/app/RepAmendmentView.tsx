import type {
  AmendmentOption,
  RepAmendmentResult,
  StrategyBreadth,
} from "@/lib/steps/schemas";

import { AmendmentLegend, AmendmentSegments } from "./AmendmentSegments";

/**
 * Step8 代表クレーム補正（REP_AMENDMENT_SCHEMA / RepAmendmentResult）の表示コンポーネント（PRD §11-S8）。
 *
 * 「必要最小限の補正」案を、補正後の代表請求項（補正箇所ハイライト＝AmendmentSegments）・広狭バッジ・
 * 新規事項でない根拠・対応拒絶理由・権利範囲・覆せる根拠・リスクとともに描く。推奨案は強調する。
 * StrategyView と同型（純表示・"use client" なし）。色は app/globals.css の @theme トークンのみ（PRD §9.0）。
 * payload は実行時 unknown 由来のため、配列は ?? [] で、recommendation は ?. で防御する。
 */

/** 権利範囲の広さ → バッジ表記＋配色（StrategyView と同じ既存トークン）。 */
const BREADTH_STYLE: Record<StrategyBreadth, { label: string; cls: string }> = {
  broad: { label: "広い", cls: "bg-terracotta text-white" },
  medium: { label: "中", cls: "bg-muted-2 text-white" },
  narrow: { label: "狭い", cls: "bg-ink-soft text-white" },
};

function BreadthBadge({ breadth }: { breadth: StrategyBreadth }) {
  const style = BREADTH_STYLE[breadth] ?? BREADTH_STYLE.medium;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-semibold ${style.cls}`}
      title={`権利範囲: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

function AmendmentCard({
  option,
  recommended,
}: {
  option: AmendmentOption;
  recommended: boolean;
}) {
  const addressed = option.addressed_rejections ?? [];
  const risks = option.risks ?? [];
  return (
    <div
      className={`rounded-lg border bg-surface p-4 ${
        recommended ? "border-terracotta ring-1 ring-terracotta" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{option.label}</span>
        <BreadthBadge breadth={option.breadth} />
        {recommended && (
          <span className="rounded bg-terracotta px-2 py-0.5 text-xs text-white">
            推奨
          </span>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-ink-soft">補正後の代表請求項</p>
        <div className="mt-1.5">
          <AmendmentSegments segments={option.segments} />
        </div>
      </div>

      {option.basis && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">
            補正の根拠（明細書）
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
            {option.basis}
          </p>
        </div>
      )}

      {addressed.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">解消する拒絶理由</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {addressed.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {option.claim_scope && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">権利範囲</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
            {option.claim_scope}
          </p>
        </div>
      )}

      {option.rationale && (
        <div className="mt-3">
          <p className="text-xs font-medium text-terracotta">
            拒絶理由を覆せる根拠
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-ink">
            {option.rationale}
          </p>
        </div>
      )}

      {risks.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">リスク</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RepAmendmentView({ result }: { result: RepAmendmentResult }) {
  const options = result.options ?? [];
  const recommendedLabel = result.recommendation?.recommended_label ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {result.representative_claim_no && (
          <span className="font-medium text-ink-soft">
            代表請求項 {result.representative_claim_no}
          </span>
        )}
        {result.country && <span>対象国: {result.country}</span>}
        <AmendmentLegend />
      </div>

      {result.recommendation?.reason && (
        <div className="rounded-lg border border-terracotta bg-cream-hover p-4">
          <p className="text-xs font-medium text-terracotta">
            推奨案{recommendedLabel ? `: ${recommendedLabel}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {result.recommendation.reason}
          </p>
        </div>
      )}

      {options.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            代表補正案（必要最小限・広狭の幅）
          </h3>
          {options.map((o, i) => (
            <AmendmentCard
              key={i}
              option={o}
              recommended={!!recommendedLabel && o.label === recommendedLabel}
            />
          ))}
        </section>
      )}

      {result.overall && (
        <div className="rounded-lg border border-line bg-cream-hover p-4">
          <p className="text-xs font-medium text-ink-soft">総評</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {result.overall}
          </p>
        </div>
      )}
    </div>
  );
}
