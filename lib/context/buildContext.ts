import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DOC_ROLES, labelForRole, type DocRole } from "@/lib/config/docRoles";
import type { Database } from "@/lib/database.types";

/**
 * Step4+ で Claude へ送る「これまでのコンテキスト」を組み立てる（PRD §10 共通 / §7.5 コスト方針）。
 *
 * コスト方針（CLAUDE.md ガードレール3 / §7.5）の核心: Step4 以降は原本 PDF を毎回送らず、
 * Step2-3 で保存した `case_files.extracted_text`（全文テキスト）を送る。図面が重要な場面のみ
 * 後続で `anthropic_file_id` を参照する（本関数は file_id を送らない）。
 *
 * 戻り値は (1) 全文書を整形した documentsBlock（先頭 user ターンに置く想定）と
 * (2) 永続化済みの会話履歴 history（時系列）。各ステップ実行関数はこれに当該ステップの
 * システムプロンプトと新規ユーザープロンプトを足して messages を構成する。
 *
 * server-only（extracted_text は機密本文。クライアントへ漏らさない。ログにも出さない＝ガードレール7）。
 * supabase は RLS 有効の server クライアント／service_role の admin クライアントのどちらでも可
 * （どちらも SupabaseClient<Database>）。
 */

/** Claude の messages に流し込む 1 ターン分（DB の role を user/assistant に正規化済み）。 */
export type ContextMessage = { role: "user" | "assistant"; content: string };

export type CaseContext = {
  /** 全文書（extracted_text 優先・無ければ summary）を DOC_ROLES 順に整形した塊。 */
  documentsBlock: string;
  /** 永続化済みチャット履歴（時系列）。 */
  history: ContextMessage[];
  /** 本文（extracted_text/summary）を持つ文書数。0 なら Step4 以降は実行不可。 */
  documentCount: number;
};

type FileRow = Pick<
  Database["public"]["Tables"]["case_files"]["Row"],
  "doc_role" | "file_name" | "extracted_text" | "summary" | "created_at"
>;

type MessageRow = Pick<
  Database["public"]["Tables"]["messages"]["Row"],
  "role" | "content" | "created_at"
>;

/** DOC_ROLES の表示順 → role 内は created_at 昇順（route.ts の orderedFiles と同規則）。 */
function orderFiles(files: FileRow[]): FileRow[] {
  const roleOrder = new Map(DOC_ROLES.map((m, i) => [m.role, i] as const));
  return files.slice().sort((a, b) => {
    const ra = roleOrder.get(a.doc_role as DocRole) ?? 99;
    const rb = roleOrder.get(b.doc_role as DocRole) ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

export async function buildCaseContext(
  supabase: SupabaseClient<Database>,
  caseId: string,
): Promise<CaseContext> {
  const { data: files, error: filesError } = await supabase
    .from("case_files")
    .select("doc_role, file_name, extracted_text, summary, created_at")
    .eq("case_id", caseId);
  if (filesError) {
    throw new Error("文書の読み込みに失敗しました。");
  }

  const ordered = orderFiles((files ?? []) as FileRow[]);

  const blocks: string[] = [];
  let documentCount = 0;
  for (const f of ordered) {
    const text = f.extracted_text?.trim() || f.summary?.trim() || "";
    if (!text) continue;
    documentCount += 1;
    const kind = f.extracted_text?.trim() ? "全文" : "概要";
    blocks.push(
      `【${labelForRole(f.doc_role as DocRole)}】${f.file_name}（${kind}）\n${text}`,
    );
  }
  const documentsBlock = blocks.join("\n\n---\n\n");

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (messagesError) {
    throw new Error("チャット履歴の読み込みに失敗しました。");
  }

  const history: ContextMessage[] = [];
  for (const m of (messages ?? []) as MessageRow[]) {
    const content = m.content?.trim();
    if (!content) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    history.push({ role: m.role, content });
  }

  return { documentsBlock, history, documentCount };
}
