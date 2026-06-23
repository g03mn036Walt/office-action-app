/**
 * 案件未選択時のトップ（/）。
 * サイドバーの「＋ 新規案件」または既存案件の選択を促す空状態。
 */
export default function AppIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-serif text-2xl text-ink-soft">案件を選択してください</p>
      <p className="text-sm text-muted">
        左の「＋ 新規案件」から新しい案件を作成するか、一覧から案件を開いてください。
      </p>
    </div>
  );
}
