import { notFound } from "next/navigation";

import { Chat } from "@/components/app/Chat";
import type { TimelineItem } from "@/components/app/ChatMessages";
import { DeleteFileButton } from "@/components/app/DeleteFileButton";
import { FileUpload } from "@/components/app/FileUpload";
import { requireUser } from "@/lib/auth";
import type { ArtifactKind } from "@/lib/chat/events";
import { DOC_ROLES, type DocRole } from "@/lib/config/docRoles";
import { stepLabel } from "@/lib/config/steps";
import { resignDocxPayload } from "@/lib/docx/deliver";
import type { Database } from "@/lib/database.types";

/** 一覧表示に必要な case_files の最小フィールド（機密本文 extracted_text は取得しない）。 */
type CaseFileRow = Pick<
  Database["public"]["Tables"]["case_files"]["Row"],
  "id" | "doc_role" | "file_name" | "file_type" | "anthropic_file_id" | "created_at"
>;

/**
 * 案件ビュー（/case/[id]）。AppShell のメイン側（ヘッダ＋文書＋チャット枠）。
 *
 * Slice 2b で文書アップロード（役割別）を配線。チャット表示・送信は Slice 3。
 * Next.js 16 では params が Promise なので await する。
 */
export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireUser();

  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, title, publication_number, country, current_step")
    .eq("id", id)
    .single();

  if (!caseRow) {
    notFound();
  }

  // 機密本文（extracted_text / summary）は一覧表示に不要なので取得しない（ガードレール7）。
  const { data: files } = await supabase
    .from("case_files")
    .select("id, doc_role, file_name, file_type, anthropic_file_id, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const caseFiles: CaseFileRow[] = files ?? [];
  const byRole = (role: DocRole) => caseFiles.filter((f) => f.doc_role === role);

  const title = caseRow.title || caseRow.publication_number || "無題";

  // チャットメッセージ＋構造化成果物（永続化済み）を取得し、created_at でインターリーブする。RLS で owner 限定。
  const { data: messageRows } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: artifactRows } = await supabase
    .from("case_artifacts")
    .select("id, kind, payload, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const messageItems = (messageRows ?? []).map((m) => ({
    at: m.created_at,
    item: {
      type: "message" as const,
      id: m.id,
      role: m.role,
      content: m.content,
    },
  }));

  // docx は失効する署名 URL を保存しないため、storage_path から再署名して DL 可能にする（PRD §8.2）。
  const artifactItems = await Promise.all(
    (artifactRows ?? []).map(async (a) => ({
      at: a.created_at,
      item: {
        type: "artifact" as const,
        id: a.id,
        kind: a.kind as ArtifactKind,
        payload:
          a.kind === "docx"
            ? await resignDocxPayload(supabase, a.payload)
            : a.payload,
      },
    })),
  );

  // user(N) → artifact(N) → assistant(N+1) の保存順がそのまま時系列で正しく並ぶ。
  const timeline: TimelineItem[] = [...messageItems, ...artifactItems]
    .sort((x, y) => (x.at ?? "").localeCompare(y.at ?? ""))
    .map((x) => x.item);

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

      {/* 文書（役割別アップロード）＋チャット（Slice 3） */}
      <Chat caseId={id} initialItems={timeline}>
          <section className="space-y-5">
            {DOC_ROLES.map((meta) => {
              const roleFiles = byRole(meta.role);
              return (
                <div key={meta.role}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h2 className="text-[13px] font-semibold text-ink-soft">{meta.label}</h2>
                    {meta.single && (
                      <span className="text-[11px] text-faint">（1件のみ）</span>
                    )}
                  </div>

                  {roleFiles.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {roleFiles.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-2 rounded-[9px] border border-line bg-surface px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
                            {f.file_name}
                          </span>
                          {f.anthropic_file_id && (
                            <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-[10.5px] text-muted">
                              PDF
                            </span>
                          )}
                          <DeleteFileButton fileId={f.id} fileName={f.file_name} />
                        </li>
                      ))}
                    </ul>
                  )}

                  <FileUpload
                    caseId={id}
                    userId={user.id}
                    role={meta.role}
                    disabled={meta.single && roleFiles.length > 0}
                  />
                </div>
              );
            })}
          </section>
      </Chat>
    </div>
  );
}
