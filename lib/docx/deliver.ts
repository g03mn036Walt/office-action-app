import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CASE_FILES_BUCKET } from "@/lib/config/storage";
import {
  DOCX_DOC_KIND_LABEL,
  type DocxDeliverResult,
} from "@/lib/steps/schemas";
import type { Database } from "@/lib/database.types";

/**
 * 永続化済み docx 成果物（case_artifacts.payload）の署名 URL を再発行する（PRD §8.2 / §7.7）。
 *
 * S14 の保存時は失効する署名 URL を載せず storage_path のみを残している（dispatch の runDocxAndPersist）。
 * 案件ページの再読込時にこの関数で storage_path から短時間の署名 URL を再発行し、ダウンロードを可能にする。
 * 署名 URL は別オリジンのため download=ファイル名を付け Content-Disposition: attachment を強制する。
 * server-only（Storage 操作はサーバーのみ。RLS で owner 限定。本文はログに出さない＝ガードレール7）。
 */
export async function resignDocxPayload(
  supabase: SupabaseClient<Database>,
  payload: unknown,
): Promise<unknown> {
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as DocxDeliverResult;
  const docs = Array.isArray(p.documents) ? p.documents : [];

  const documents = await Promise.all(
    docs.map(async (d) => {
      if (!d?.storage_path) return d;
      const label = DOCX_DOC_KIND_LABEL[d.doc_kind] ?? "書面";
      const { data: signed } = await supabase.storage
        .from(CASE_FILES_BUCKET)
        .createSignedUrl(d.storage_path, 3600, { download: `${label}.docx` });
      return { ...d, download_url: signed?.signedUrl ?? "" };
    }),
  );

  return { ...p, documents };
}
