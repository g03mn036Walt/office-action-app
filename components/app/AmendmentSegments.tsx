import type { AmendmentSegment } from "@/lib/steps/schemas";

/**
 * 補正後クレームを文節（segment）の列で描く共有コンポーネント（PRD §9.4）。
 * S8 代表補正（RepAmendmentView）と S10 全文補正（FullAmendmentView）の双方で再利用する。
 *
 * 各 segment の change で配色を分ける（add=追記/緑下線, delete=削除/赤取消線, keep=据置/既定色）。
 * 色は app/globals.css の @theme トークンのみで構成する（場当たりの色値を足さない＝PRD §9.0）。
 * "use client" は付けない（状態・イベントを持たない純粋な表示）。payload は実行時 unknown 由来のため
 * 配列は ?? [] で、未知の change はフォールバックして描く。
 */

/** change → 配色（既存トークン + 装飾のみ）。 */
const CHANGE_STYLE: Record<AmendmentSegment["change"], string> = {
  keep: "text-ink",
  add: "text-success underline decoration-success/60",
  delete: "text-error line-through",
};

/** 補正箇所の凡例（追記=緑下線 / 削除=赤取消線 / 据置=既定）。 */
export function AmendmentLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="font-medium text-ink-soft">補正箇所</span>
      <span className={CHANGE_STYLE.add}>追記</span>
      <span className={CHANGE_STYLE.delete}>削除</span>
      <span className={CHANGE_STYLE.keep}>据置</span>
    </div>
  );
}

/** 補正後クレーム（segment 列）を 1 段落としてインライン描画する。 */
export function AmendmentSegments({
  segments,
}: {
  segments: AmendmentSegment[];
}) {
  const segs = segments ?? [];
  return (
    <p className="whitespace-pre-wrap break-words rounded-lg border border-line bg-cream-hover px-3 py-2 text-sm leading-relaxed">
      {segs.map((s, i) => (
        <span key={i} className={CHANGE_STYLE[s.change] ?? CHANGE_STYLE.keep}>
          {s.text}
        </span>
      ))}
    </p>
  );
}
