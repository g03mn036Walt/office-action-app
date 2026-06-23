import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { stepLabel } from "@/lib/config/steps";

/**
 * 案件ビュー（/case/[id]）。AppShell のメイン側（ヘッダ＋チャット＋入力枠）。
 *
 * Slice 1 ではヘッダ（案件タイトル・対象国・ステップ）まで実装し、
 * チャット表示・送信は Slice 3、文書アップロードは Slice 2 で配線する。
 * Next.js 16 では params が Promise なので await する。
 */
export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireUser();

  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, title, publication_number, country, current_step")
    .eq("id", id)
    .single();

  if (!caseRow) {
    notFound();
  }

  const title = caseRow.title || caseRow.publication_number || "無題";

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダ */}
      <div className="flex h-[60px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-6">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {caseRow.country && (
          <span className="rounded-full bg-cream px-2.5 py-0.5 text-xs text-ink-soft">
            {caseRow.country}
          </span>
        )}
        <span className="ml-auto text-[12.5px] text-muted">
          Step {caseRow.current_step} / 14 · {stepLabel(caseRow.current_step)}
        </span>
      </div>

      {/* チャット（Slice 3 で配線） */}
      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto max-w-[720px] px-6">
          <p className="text-sm text-muted">
            この案件のチャットは Step3（要約）実装後に表示されます。まずは文書をアップロードしてください（アップロードは次の実装段階で有効化）。
          </p>
        </div>
      </div>

      {/* 入力枠（Slice 3 で有効化） */}
      <div className="shrink-0 border-t border-line bg-surface px-6 py-4">
        <div className="mx-auto max-w-[720px] rounded-xl border border-field bg-surface p-3.5">
          <textarea
            disabled
            rows={1}
            placeholder="メッセージを入力…（次の実装段階で有効化）"
            className="w-full resize-none bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      </div>
    </div>
  );
}
