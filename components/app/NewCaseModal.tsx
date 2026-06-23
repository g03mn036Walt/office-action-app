"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { COUNTRIES } from "@/lib/config/countries";
import { createCase } from "@/lib/cases/actions";

/**
 * 新規案件作成モーダル（Claude Design: NewCase.dc.html の翻訳）。
 *
 * Slice 1 では公報番号・対象国の入力 → 案件作成 → 案件画面へ遷移までを担う。
 * 4文書のドロップ欄はデザイン通り配置するが、Storage + Files API への配線は
 * Slice 2 で行うため、ここでは無効表示（操作不可）にしている。
 */

const DOC_ROLES = ["本願明細書", "OA（拒絶理由）", "引用文献", "現クレーム"] as const;

export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [publicationNumber, setPublicationNumber] = useState("");
  const [country, setCountry] = useState<string>(COUNTRIES[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await createCase({ publicationNumber, country });
        onClose();
        router.push(`/case/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "作成に失敗しました");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[540px] overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-[26px] py-[22px]">
          <h2 className="font-serif text-xl text-ink">新規案件</h2>
          <p className="mt-1 text-[13px] text-muted">
            公報番号と対象国を入力し、関連文書をアップロードしてください。
          </p>
        </div>

        <div className="px-[26px] py-[22px]">
          <div className="mb-5 flex gap-3.5">
            <div className="flex-1">
              <label className="mb-[7px] block text-[13px] font-semibold text-ink-soft">
                公報番号
              </label>
              <input
                type="text"
                value={publicationNumber}
                onChange={(e) => setPublicationNumber(e.target.value)}
                placeholder="例: 特願2024-123456"
                className="w-full rounded-[9px] border border-field bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-terracotta"
              />
            </div>
            <div className="flex-1">
              <label className="mb-[7px] block text-[13px] font-semibold text-ink-soft">
                対象国
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-[9px] border border-field bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-terracotta"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="mb-[7px] block text-[13px] font-semibold text-ink-soft">
            文書アップロード
          </label>
          {/* Slice 2 で配線。現状はデザイン表示のみ（操作不可）。 */}
          <div className="grid grid-cols-2 gap-3 opacity-50">
            {DOC_ROLES.map((role) => (
              <div
                key={role}
                aria-disabled
                className="cursor-not-allowed rounded-[11px] border-[1.5px] border-dashed border-field p-4 text-center"
              >
                <div className="mb-0.5 text-[13px] font-semibold text-ink-soft">{role}</div>
                <div className="text-[11.5px] text-faint">ドラッグ &amp; ドロップ</div>
                <div className="mt-1.5 text-[10.5px] text-faint">PDF / DOCX / TXT</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted-2">
            ※ 文書アップロードは次の実装段階（Slice 2）で有効化します。
          </p>

          {error && <p className="mt-3 text-[13px] text-error">{error}</p>}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-line px-[26px] py-[18px]">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-[9px] border border-field bg-transparent px-[18px] py-2.5 text-sm text-ink-soft transition-colors hover:bg-cream-hover disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={pending}
            className="rounded-[9px] border-none bg-terracotta px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terracotta-dark disabled:opacity-50"
          >
            {pending ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
