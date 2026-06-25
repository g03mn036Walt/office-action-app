import "server-only";

import { toFile } from "@anthropic-ai/sdk";

import { getAnthropic } from "@/lib/anthropic/client";

/**
 * Anthropic Files API のサーバー専用ラッパ（CLAUDE.md ガードレール4、PRD §7.4）。
 *
 * beta ヘッダ files-api-2025-04-14 が必要。SDK の upload/delete に betas を渡すと
 * 自動付与される。クライアントは getAnthropic() を再利用する（新規生成しない）。
 * API キーは getAnthropic() 内でのみ参照し、ここでは触れない（ガードレール1）。
 */

const FILES_API_BETA = "files-api-2025-04-14";

/**
 * PDF を Files API にアップロードし、file_id を返す。
 * 返した file_id は case_files.anthropic_file_id に保存する（Step1）。
 * Supabase Storage の Blob を SDK の file 形式へ toFile で変換する。
 */
export async function uploadPdf(blob: Blob, fileName: string): Promise<string> {
  const file = await toFile(blob, fileName, { type: "application/pdf" });
  const uploaded = await getAnthropic().beta.files.upload({
    file,
    betas: [FILES_API_BETA],
  });
  return uploaded.id;
}

/** Files API 上のファイルを削除する（案件・ファイル削除時のクリーンアップ）。 */
export async function deleteFile(fileId: string): Promise<void> {
  await getAnthropic().beta.files.delete(fileId, {
    betas: [FILES_API_BETA],
  });
}
