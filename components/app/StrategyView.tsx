import type {
  StrategyBreadth,
  StrategyOption,
  StrategyResult,
} from "@/lib/steps/schemas";

/**
 * Step6 応答方針（STRATEGY_SCHEMA / StrategyResult）の表示コンポーネント（PRD §11-S6）。
 *
 * 「拒絶理由を覆せる範囲で最も広いクレームを狙う」3 案以上を、広狭バッジ・拒絶理由を覆せる根拠
 * （審査官の弱点をどう突くか）・権利範囲・リスク・補正の方向性とともに描く。推奨案は強調する。
 * "use client" は付けない（状態・イベントを持たない純粋な表示）。手順3-B で Chat.tsx（client）の
 * artifact 描画に組み込む想定だが、それ自体は Server/Client どちらでも動く。
 *
 * 色は app/globals.css の @theme トークンのみで構成する（PRD §9.0）。payload は実行時に unknown
 * 由来のため、配列は ?? [] で、recommendation は ?. で防御する。
 */

/** 権利範囲の広さ → バッジ表記＋配色（既存トークンのみ）。 */
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

function StrategyCard({
  strategy,
  recommended,
}: {
  strategy: StrategyOption;
  recommended: boolean;
}) {
  const risks = strategy.risks ?? [];
  return (
    <div
      className={`rounded-lg border bg-surface p-4 ${
        recommended ? "border-terracotta ring-1 ring-terracotta" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{strategy.label}</span>
        <BreadthBadge breadth={strategy.breadth} />
        {recommended && (
          <span className="rounded bg-terracotta px-2 py-0.5 text-xs text-white">
            推奨
          </span>
        )}
      </div>

      {strategy.approach && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
          {strategy.approach}
        </p>
      )}

      {strategy.rationale && (
        <div className="mt-3">
          <p className="text-xs font-medium text-terracotta">
            拒絶理由を覆せる根拠（審査官の弱点）
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-ink">
            {strategy.rationale}
          </p>
        </div>
      )}

      {strategy.claim_scope && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">権利範囲</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
            {strategy.claim_scope}
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

      {strategy.amendment_outline && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">補正の方向性</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
            {strategy.amendment_outline}
          </p>
        </div>
      )}
    </div>
  );
}

export function StrategyView({ result }: { result: StrategyResult }) {
  const strategies = result.strategies ?? [];
  const recommendedLabel = result.recommendation?.recommended_label ?? "";

  return (
    <div className="space-y-6">
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

      {strategies.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            応答方針案（広狭の幅）
          </h3>
          {strategies.map((s, i) => (
            <StrategyCard
              key={i}
              strategy={s}
              recommended={!!recommendedLabel && s.label === recommendedLabel}
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
