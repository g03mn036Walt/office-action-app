"use client";

import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { registerUploadedFile } from "@/lib/cases/actions";
import {
  ACCEPT_ATTRIBUTE,
  extensionOf,
  isAcceptedExtension,
  labelForRole,
  type DocRole,
} from "@/lib/config/docRoles";
import { createClient } from "@/lib/supabase/client";

/**
 * 役割別ファイルアップロードタイル（Slice 2b）。
 *
 * ブラウザから直接 Supabase Storage に put（パス {user_id}/{case_id}/{filename}）し、
 * 続けて registerUploadedFile（Server Action）を呼んで case_files に登録する。
 * PDF は Files API へ、その他はサーバー側でテキスト抽出される（2a 実装）。
 *
 * userId は server page（requireUser 済み）から prop で受け取る。Storage の RLS は
 * パス先頭セグメント == auth.uid() を要求するため（migration 0003）ここで使う。
 * 所有権の実強制は RLS（Storage ポリシー＋Server Action の requireUser）が担うので、
 * この値は RLS 述語を満たすためのもの（改竄したパスは Storage ポリシーが拒否する）。
 */
export function FileUpload({
  caseId,
  userId,
  role,
  disabled = false,
}: {
  caseId: string;
  userId: string;
  role: DocRole;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isDisabled = disabled || pending;

  function handlePick() {
    if (isDisabled) return;
    inputRef.current?.click();
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同名ファイルを続けて選べるようリセット
    if (!file) return;

    setError(null);

    // 前段検証（サーバー側でも拡張子判定で再検証される）。
    if (!isAcceptedExtension(extensionOf(file.name))) {
      setError("対応していないファイル形式です（PDF / DOCX / TXT / MD / CSV）");
      return;
    }

    startTransition(async () => {
      try {
        const supabase = createClient();
        const storagePath = `${userId}/${caseId}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("case-files")
          .upload(storagePath, file, {
            contentType: file.type || undefined,
            upsert: false,
          });
        if (uploadError) {
          // Storage put 自体が失敗＝オブジェクト未作成なので後始末は不要。
          setError(uploadError.message);
          return;
        }

        await registerUploadedFile({
          caseId,
          docRole: role,
          fileName: file.name,
          fileType: file.type || null,
          storagePath,
        });
        router.refresh();
      } catch (err) {
        // Server Action は和文メッセージを throw する（機密本文は含めない＝表示安全）。
        setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      }
    });
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        onChange={handleChange}
        disabled={isDisabled}
        className="hidden"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={isDisabled}
        aria-label={`${labelForRole(role)}をアップロード`}
        className={`w-full rounded-[11px] border-[1.5px] border-dashed border-field p-4 text-center transition-colors ${
          isDisabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:border-terracotta hover:bg-cream-hover"
        }`}
      >
        <div className="text-[13px] font-semibold text-ink-soft">
          {pending ? "アップロード中…" : disabled ? "登録済み" : "＋ ファイルを追加"}
        </div>
        <div className="mt-1 text-[10.5px] text-faint">PDF / DOCX / TXT / MD / CSV</div>
      </button>
      {error && <p className="mt-1.5 text-[12px] text-error">{error}</p>}
    </div>
  );
}
