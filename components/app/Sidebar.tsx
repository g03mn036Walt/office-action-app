"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Brandmark } from "@/components/ui/Brandmark";
import { NewCaseModal } from "@/components/app/NewCaseModal";
import { deleteCase, setFavorite } from "@/lib/cases/actions";
import { stepLabel } from "@/lib/config/steps";

/** サイドバーに表示する案件の最小フィールド。 */
export type CaseListItem = {
  id: string;
  title: string | null;
  publication_number: string | null;
  country: string | null;
  current_step: number;
  is_favorite: boolean;
};

export function Sidebar({
  cases,
  userName,
}: {
  cases: CaseListItem[];
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const activeId = pathname.startsWith("/case/") ? pathname.split("/")[2] : null;
  const favorites = cases.filter((c) => c.is_favorite);
  const normal = cases.filter((c) => !c.is_favorite);
  const avatar = userName.charAt(0).toUpperCase() || "U";

  async function handleToggleFavorite(c: CaseListItem) {
    setMenuFor(null);
    await setFavorite(c.id, !c.is_favorite);
    router.refresh();
  }

  async function handleDelete(c: CaseListItem) {
    setMenuFor(null);
    // cascade で関連文書（case_files / Storage / Files API / messages）も消えるため確認する。
    const name = c.title || c.publication_number || "この案件";
    if (
      !window.confirm(`「${name}」を削除します。関連文書もすべて削除され、元に戻せません。よろしいですか？`)
    ) {
      return;
    }
    await deleteCase(c.id);
    if (activeId === c.id) {
      router.push("/");
    } else {
      router.refresh();
    }
  }

  function renderCase(c: CaseListItem) {
    const isActive = activeId === c.id;
    return (
      <div
        key={c.id}
        onClick={() => router.push(`/case/${c.id}`)}
        className={`group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 ${
          isActive ? "bg-cream" : "hover:bg-cream-hover"
        } ${menuFor === c.id ? "z-50" : ""}`}
      >
        <span className="w-[13px] shrink-0 text-center text-[13px] text-terracotta">
          {c.is_favorite ? "★" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] text-ink-soft">
            {c.title || c.publication_number || "無題"}
          </div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            {[c.country, `Step ${c.current_step}`, stepLabel(c.current_step)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        <button
          type="button"
          aria-label="案件メニュー"
          onClick={(e) => {
            e.stopPropagation();
            setMenuFor(menuFor === c.id ? null : c.id);
          }}
          className="shrink-0 rounded px-1 text-muted-2 opacity-0 transition-opacity hover:text-ink-soft group-hover:opacity-100"
        >
          ⋯
        </button>

        {menuFor === c.id && (
          <div
            className="absolute right-2 top-[42px] z-50 w-36 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(31,30,29,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleToggleFavorite(c)}
              className="block w-full px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-cream-hover"
            >
              {c.is_favorite ? "お気に入り解除" : "お気に入り登録"}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(c)}
              className="block w-full px-3 py-2 text-left text-[13px] text-error hover:bg-cream-hover"
            >
              削除
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* メニュー外クリックで閉じる透明オーバーレイ（メニューを開いた行は z-50 で前面） */}
      {menuFor && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} aria-hidden />
      )}

      <aside className="flex h-screen flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-4 py-5">
          <Brandmark size="sm" />
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mx-4 mb-2 mt-3.5 flex items-center justify-center gap-2 rounded-[9px] bg-terracotta px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terracotta-dark"
        >
          ＋ 新規案件
        </button>

        <div className="flex-1 overflow-y-auto px-2.5 py-2">
          {cases.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-faint">
              案件はまだありません
            </p>
          )}

          {favorites.length > 0 && (
            <>
              <div className="px-2 pb-1.5 pt-2.5 text-[11px] uppercase tracking-[0.06em] text-muted-2">
                お気に入り
              </div>
              {favorites.map(renderCase)}
            </>
          )}

          {normal.length > 0 && (
            <>
              <div className="px-2 pb-1.5 pt-2.5 text-[11px] uppercase tracking-[0.06em] text-muted-2">
                案件
              </div>
              {normal.map(renderCase)}
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-terracotta text-[13px] text-white">
            {avatar}
          </div>
          <span className="flex-1 truncate text-[13px] text-muted">{userName}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-[12.5px] text-muted-2 transition-colors hover:text-terracotta"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      <NewCaseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
