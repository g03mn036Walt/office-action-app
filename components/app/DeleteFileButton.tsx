"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteFile } from "@/lib/cases/actions";

/**
 * 個別ファイル削除ボタン（Slice 2b）。
 *
 * page.tsx（Server Component）から deleteFile（Server Action）を呼ぶための
 * 小さなクライアントラッパ。Sidebar の案件削除と同様、確認ダイアログを挟む。
 * deleteFile が Storage + Files API + case_files 行をまとめて消す（2a 実装）。
 */
export function DeleteFileButton({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (pending) return;
    if (!window.confirm(`「${fileName}」を削除します。元に戻せません。よろしいですか？`)) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteFile(fileId);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      aria-label={`${fileName}を削除`}
      className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-muted-2 transition-colors hover:text-error disabled:opacity-50"
    >
      {pending ? "削除中…" : "削除"}
    </button>
  );
}
