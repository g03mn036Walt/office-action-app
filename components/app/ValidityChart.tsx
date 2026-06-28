import type {
  ValidityResult,
  ValidityScore,
} from "@/lib/steps/schemas";

/**
 * Step4-S5 妥当性評価（VALIDITY_SCHEMA / ValidityResult）の表示コンポーネント。
 *
 * 請求項 × 構成要件（文節）× 引用文献の 5 段階スコアと、拒絶理由ごとの審査官の強い点／弱い点、
 * 総評を描く。"use client" は付けない（状態・イベント・ブラウザ API を使わない純粋な表示）。手順3 で
 * Chat.tsx（client）の artifact 描画に組み込む想定だが、それ自体は Server/Client どちらでも動く。
 *
 * 色は app/globals.css の @theme トークンのみで構成する（場当たりの色値を足さない＝PRD §9.0）。
 * スコアの意味は出願人視点: 5=審査官主張が妥当（開示あり・反論困難=赤）, 1=妥当でない（反論余地大=緑）。
 * payload は実行時に unknown 由来のため、配列は ?? [] で防御し、score はクランプして描く。
 */

/** スコア → バッジ配色（既存トークン + 透明度のみ。5=赤 … 1=緑）。 */
const SCORE_STYLE: Record<ValidityScore, string> = {
  5: "bg-error text-white",
  4: "bg-terracotta text-white",
  3: "bg-muted-2 text-white",
  2: "bg-success/70 text-white",
  1: "bg-success text-white",
};

/** 想定外の数値（範囲外・小数）でも 1..5 の整数に丸める。 */
function clampScore(score: number): ValidityScore {
  const r = Math.round(score);
  if (r <= 1) return 1;
  if (r >= 5) return 5;
  return r as ValidityScore;
}

function ScoreBadge({ score }: { score: number }) {
  const s = clampScore(score);
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold ${SCORE_STYLE[s]}`}
      title={`妥当性スコア ${s}`}
    >
      {s}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="font-medium text-ink-soft">妥当性スコア</span>
      <span className="flex items-center gap-1">
        <ScoreBadge score={5} /> 妥当・反論困難
      </span>
      <span className="flex items-center gap-1">
        <ScoreBadge score={3} /> 解釈次第
      </span>
      <span className="flex items-center gap-1">
        <ScoreBadge score={1} /> 弱い・反論余地大
      </span>
    </div>
  );
}

export function ValidityChart({ result }: { result: ValidityResult }) {
  const claims = result.claims ?? [];
  const rejections = result.rejections ?? [];

  return (
    <div className="space-y-6">
      <Legend />

      {rejections.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">拒絶理由の妥当性</h3>
          {rejections.map((r, i) => (
            <div
              key={i}
              className="rounded-lg border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-ink-soft px-2 py-0.5 text-xs text-white">
                  {r.type}
                </span>
                {(r.target_claims ?? []).length > 0 && (
                  <span className="text-xs text-muted">
                    請求項 {r.target_claims.join(", ")}
                  </span>
                )}
              </div>

              {(r.examiner_strong_points ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-ink-soft">
                    審査官の主張が強い点
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
                    {r.examiner_strong_points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(r.examiner_weak_points ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-terracotta">
                    審査官の弱点・誤り（反論の足がかり）
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink">
                    {r.examiner_weak_points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {r.notes && (
                <p className="mt-3 text-xs text-muted">{r.notes}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {claims.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            請求項 × 構成要件 × 引用文献
          </h3>
          {claims.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-line bg-surface p-4"
            >
              <p className="text-sm font-medium text-ink">
                請求項 {c.claim_no}
              </p>
              <div className="mt-2 space-y-3">
                {(c.elements ?? []).map((el, j) => (
                  <div
                    key={j}
                    className="border-t border-line pt-3 first:border-t-0 first:pt-0"
                  >
                    <p className="text-sm text-ink">{el.text}</p>
                    <ul className="mt-2 space-y-1.5">
                      {(el.assessments ?? []).map((a, k) => (
                        <li key={k} className="flex gap-2 text-xs">
                          <ScoreBadge score={a.score} />
                          <div className="min-w-0">
                            <span className="font-medium text-ink-soft">
                              {a.reference}
                            </span>
                            {a.rationale && (
                              <span className="text-muted"> — {a.rationale}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
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
