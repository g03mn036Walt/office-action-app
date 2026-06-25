"use server";

import { revalidatePath } from "next/cache";

import { deleteFile as deleteAnthropicFile, uploadPdf } from "@/lib/anthropic/files";
import { requireUser } from "@/lib/auth";
import { type DocRole, extensionOf, isSingleRole } from "@/lib/config/docRoles";
import { extractText } from "@/lib/extract/text";

/**
 * 案件・ファイルの Server Actions（PRD §14 タスク6-7 / §9.2）。
 * すべて requireUser で認証し、RLS と合わせて owner のデータのみ操作する
 * （admin.ts は使わない）。API キー・機密本文（抽出テキスト等）はログや戻り値に
 * 出さない（CLAUDE.md ガードレール1/7）。
 *
 * 注意: createCase は redirect せず新 ID を返す。呼び出し側（Client）が
 * router.push で遷移する（Server Action 内 redirect の try/catch 落とし穴回避）。
 */

/** アップロード文書を置く Storage バケット（migration 0003、path = {user_id}/{case_id}/{uuid}.{ext}）。 */
const CASE_FILES_BUCKET = "case-files";

export type CreateCaseInput = {
  publicationNumber: string;
  country: string;
};

/** 新規案件を作成し、作成された案件 ID を返す。 */
export async function createCase(input: CreateCaseInput): Promise<{ id: string }> {
  const { supabase, user } = await requireUser();

  const publicationNumber = input.publicationNumber.trim();
  // title は一覧表示用。未入力なら公報番号、それも無ければ「無題」。
  const title = publicationNumber || "無題";

  const { data, error } = await supabase
    .from("cases")
    .insert({
      user_id: user.id,
      publication_number: publicationNumber || null,
      country: input.country,
      title,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "案件の作成に失敗しました");
  }

  revalidatePath("/", "layout");
  return { id: data.id };
}

/**
 * 案件を削除する。case_files 行は FK の on delete cascade で消えるが、
 * Storage と Files API は cascade の対象外なので、case 行削除の前に明示的に消す。
 */
export async function deleteCase(id: string): Promise<void> {
  const { supabase } = await requireUser();

  // 当該 case の全ファイルの後始末対象を取得（RLS で owner 限定）。
  const { data: files, error: filesError } = await supabase
    .from("case_files")
    .select("storage_path, anthropic_file_id")
    .eq("case_id", id);
  if (filesError) {
    throw new Error(filesError.message);
  }

  if (files && files.length > 0) {
    const paths = files
      .map((f) => f.storage_path)
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) {
      await supabase.storage.from(CASE_FILES_BUCKET).remove(paths);
    }
    for (const f of files) {
      if (f.anthropic_file_id) {
        await deleteAnthropicFile(f.anthropic_file_id);
      }
    }
  }

  // case_files 行は cascade で消える。
  const { error } = await supabase.from("cases").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/", "layout");
}

/** お気に入りの登録/解除を切り替える。 */
export async function setFavorite(id: string, isFavorite: boolean): Promise<void> {
  const { supabase } = await requireUser();

  const { error } = await supabase
    .from("cases")
    .update({ is_favorite: isFavorite })
    .eq("id", id);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/", "layout");
}

export type RegisterUploadedFileInput = {
  caseId: string;
  docRole: DocRole;
  fileName: string;
  /** ブラウザ由来の MIME。保存用（抽出/分岐には使わない＝拡張子で判定）。 */
  fileType: string | null;
  /** クライアントが put した Storage パス（{user_id}/{case_id}/{uuid}.{ext}）。 */
  storagePath: string;
};

/**
 * クライアントが Storage に直接 put したファイルを登録する（Step1）。
 * download → PDF は Files API へ upload／その他はテキスト抽出 → case_files に insert。
 *
 * クリーンアップ順序（docs/phase1-plan.md）: upload/抽出が成功してから insert。
 * 失敗時は put 済み Storage オブジェクト（と必要なら Files API のファイル）を消し、
 * 孤児を残さない。戻り値は新規行の id のみ（機密本文は返さない）。
 */
export async function registerUploadedFile(
  input: RegisterUploadedFileInput,
): Promise<{ id: string }> {
  const { supabase } = await requireUser();
  const { caseId, docRole, fileName, fileType, storagePath } = input;

  // put 済みファイルを消す後始末（失敗時に呼ぶ。後始末失敗で元エラーを隠さない）。
  const removeOrphan = async () => {
    try {
      await supabase.storage.from(CASE_FILES_BUCKET).remove([storagePath]);
    } catch {
      // 後始末失敗は致命的ではない。詳細はログに出さない。
    }
  };

  // applicant は1案件1件のみ。既存があれば insert せず拒否し、put 済みファイルを削除。
  if (isSingleRole(docRole)) {
    const { data: existing, error: existingError } = await supabase
      .from("case_files")
      .select("id")
      .eq("case_id", caseId)
      .eq("doc_role", docRole)
      .limit(1);
    if (existingError) {
      await removeOrphan();
      throw new Error(existingError.message);
    }
    if (existing && existing.length > 0) {
      await removeOrphan();
      throw new Error(
        "本願明細書は1件のみ登録できます（差し替えは削除してから再アップロードしてください）",
      );
    }
  }

  // RLS 下で Storage から取得。owner 外のパスは取得できない（二重防御）。
  const { data: blob, error: downloadError } = await supabase.storage
    .from(CASE_FILES_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    await removeOrphan();
    throw new Error(
      downloadError?.message ?? "アップロード済みファイルの取得に失敗しました",
    );
  }

  // PDF は Files API、その他は抽出。どちらも成功してから insert する。
  let anthropicFileId: string | null = null;
  let extractedText: string | null = null;
  try {
    if (extensionOf(fileName) === "pdf") {
      anthropicFileId = await uploadPdf(blob, fileName);
    } else {
      extractedText = await extractText(blob, fileName);
    }
  } catch (err) {
    await removeOrphan();
    throw err instanceof Error ? err : new Error("ファイルの処理に失敗しました");
  }

  const { data, error } = await supabase
    .from("case_files")
    .insert({
      case_id: caseId,
      doc_role: docRole,
      file_name: fileName,
      file_type: fileType,
      storage_path: storagePath,
      anthropic_file_id: anthropicFileId,
      extracted_text: extractedText,
    })
    .select("id")
    .single();

  if (error || !data) {
    // insert 失敗時は Files API 側のアップロードも巻き戻す。
    if (anthropicFileId) {
      try {
        await deleteAnthropicFile(anthropicFileId);
      } catch {
        // Files API 側の後始末失敗は致命的ではない。詳細はログに出さない。
      }
    }
    await removeOrphan();
    throw new Error(error?.message ?? "ファイルの登録に失敗しました");
  }

  revalidatePath(`/case/${caseId}`);
  return { id: data.id };
}

/**
 * 個別ファイルを削除する（Storage + Files API + case_files 行）。
 * RLS により owner のファイルのみ操作可能。
 */
export async function deleteFile(fileId: string): Promise<void> {
  const { supabase } = await requireUser();

  const { data: file, error: fetchError } = await supabase
    .from("case_files")
    .select("case_id, storage_path, anthropic_file_id")
    .eq("id", fileId)
    .single();
  if (fetchError || !file) {
    throw new Error(fetchError?.message ?? "ファイルが見つかりません");
  }

  if (file.storage_path) {
    await supabase.storage.from(CASE_FILES_BUCKET).remove([file.storage_path]);
  }
  if (file.anthropic_file_id) {
    await deleteAnthropicFile(file.anthropic_file_id);
  }

  const { error: deleteError } = await supabase
    .from("case_files")
    .delete()
    .eq("id", fileId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  revalidatePath(`/case/${file.case_id}`);
}
