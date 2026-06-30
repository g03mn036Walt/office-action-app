import type { AmendedClaim, FullAmendmentResult } from "@/lib/steps/schemas";

import { AmendmentLegend, AmendmentSegments } from "./AmendmentSegments";

/**
 * Step10 全文クレーム補正（FULL_AMENDMENT_SCHEMA / FullAmendmentResult）の表示コンポーネント（PRD §11-S10）。
 *
 * 補正後の全クレームを、番号・種別（独立/従属）・従属先・補正後クレーム（ハイライト＝AmendmentSegments）・
 * 新規事項でない根拠とともに描く。補正の要点・解消する拒絶理由・総評も表示する。
 * 純表示（"use client" なし）。色は app/globals.css の @theme トークンのみ（PRD §9.0）。
 * payload は実行時 unknown 由来のため、配列は ?? [] で防御する。
 */

/** 種別バッジ（独立=強調 / 従属=控えめ。既存トークンのみ）。 */
function ClaimTypeBadge({ claim }: { claim: AmendedClaim }) {
  const isIndependent = claim.claim_type === "independent";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-semibold ${
        isIndependent ? "bg-ink-soft text-white" : "bg-muted-2 text-white"
      }`}
    >
      {isIndependent ? "独立項" : "従属項"}
    </span>
  );
}

function ClaimRow({ claim }: { claim: AmendedClaim }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">
          請求項 {claim.claim_no}
        </span>
        <ClaimTypeBadge claim={claim} />
        {claim.claim_type === "dependent" && claim.depends_on && (
          <span className="text-xs text-muted">従属先: {claim.depends_on}</span>
        )}
      </div>

      <div className="mt-2">
        <AmendmentSegments segments={claim.segments} />
      </div>

      {claim.basis && (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-ink-soft">根拠（明細書）: </span>
          {claim.basis}
        </p>
      )}
    </div>
  );
}

export function FullAmendmentView({
  result,
}: {
  result: FullAmendmentResult;
}) {
  const claims = result.claims ?? [];
  const addressed = result.addressed_rejections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {result.country && <span>対象国: {result.country}</span>}
        <AmendmentLegend />
      </div>

      {result.summary_of_changes && (
        <div className="rounded-lg border border-terracotta bg-cream-hover p-4">
          <p className="text-xs font-medium text-terracotta">補正の要点</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {result.summary_of_changes}
          </p>
        </div>
      )}

      {claims.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            全文補正案（全請求項）
          </h3>
          {claims.map((c, i) => (
            <ClaimRow key={i} claim={c} />
          ))}
        </section>
      )}

      {addressed.length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-medium text-ink-soft">解消する拒絶理由</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {addressed.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
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
