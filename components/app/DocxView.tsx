import type {
  DocxDeliverResult,
  DocxDocKind,
  DocxDownloadDocument,
} from "@/lib/steps/schemas";

/**
 * Step14 書面出力（DOCX_SCHEMA → DocxDeliverResult）の表示コンポーネント（PRD §11-S14 / §9.4）。
 *
 * 補正書・意見書・見解書を、見出し＋本文のプレビューとダウンロードボタン（署名 URL）で描く。
 * 実ファイル(.docx)は dispatch 層が生成・Storage 保存済み。純表示（"use client" なし・<a download> のみ）。
 * 色は app/globals.css の @theme トークンのみ（PRD §9.0）。payload は実行時 unknown 由来のため配列は ?? [] で防御する。
 */

/** doc_kind → 日本語ラベル（build.ts と一致）。 */
const DOC_KIND_LABEL: Record<DocxDocKind, string> = {
  amendment: "補正書",
  opinion: "意見書",
  view: "見解書",
};

function DocCard({ doc }: { doc: DocxDownloadDocument }) {
  const label = DOC_KIND_LABEL[doc.doc_kind] ?? "書面";
  const sections = doc.sections ?? [];
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded bg-ink-soft px-2 py-0.5 text-xs text-white">
            {label}
          </span>
          {doc.title && (
            <p className="mt-1 text-sm font-medium text-ink">{doc.title}</p>
          )}
        </div>
        {doc.download_url && (
          <a
            href={doc.download_url}
            download={`${label}.docx`}
            className="inline-flex shrink-0 items-center rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark"
          >
            .docx をダウンロード
          </a>
        )}
      </div>

      {sections.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {sections.map((s, i) => (
            <div key={i}>
              {s.heading && (
                <p className="text-xs font-medium text-ink-soft">{s.heading}</p>
              )}
              {s.body && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted">
                  {s.body}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocxView({ result }: { result: DocxDeliverResult }) {
  const documents = result.documents ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {result.country && <span>対象国: {result.country}</span>}
      </div>

      {documents.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-ink-soft">
            生成書面（ダウンロード可）
          </h3>
          {documents.map((d, i) => (
            <DocCard key={i} doc={d} />
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
