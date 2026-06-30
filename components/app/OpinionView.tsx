import type { OpinionArgument, OpinionResult } from "@/lib/steps/schemas";

/**
 * Step12 意見書（OPINION_SCHEMA / OpinionResult）の表示コンポーネント（PRD §11-S12）。
 *
 * 前置き＋拒絶理由ごとの反論（主張・明細書根拠・エストッペル配慮）＋むすび・総評を描く。
 * 純表示（"use client" なし）。色は app/globals.css の @theme トークンのみ（PRD §9.0）。
 * payload は実行時 unknown 由来のため、配列は ?? [] で防御する。
 */

function ArgumentCard({ arg }: { arg: OpinionArgument }) {
  const basis = arg.spec_basis ?? [];
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      {arg.rejection && (
        <span className="inline-flex items-center rounded bg-ink-soft px-2 py-0.5 text-xs text-white">
          {arg.rejection}
        </span>
      )}

      {arg.argument && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
          {arg.argument}
        </p>
      )}

      {basis.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">
            明細書の根拠（抜粋）
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {basis.map((b, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {arg.estoppel_note && (
        <div className="mt-3">
          <p className="text-xs font-medium text-terracotta">
            エストッペル配慮
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-ink">
            {arg.estoppel_note}
          </p>
        </div>
      )}
    </div>
  );
}

export function OpinionView({ result }: { result: OpinionResult }) {
  const args = result.arguments ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {result.country && <span>対象国: {result.country}</span>}
      </div>

      {result.introduction && (
        <div className="rounded-lg border border-line bg-cream-hover p-4">
          <p className="text-xs font-medium text-ink-soft">前置き</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {result.introduction}
          </p>
        </div>
      )}

      {args.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            拒絶理由ごとの反論
          </h3>
          {args.map((a, i) => (
            <ArgumentCard key={i} arg={a} />
          ))}
        </section>
      )}

      {result.conclusion && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-medium text-ink-soft">むすび</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {result.conclusion}
          </p>
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
