-- handle_new_user は auth.users トリガー専用。PostgREST RPC から呼べないよう EXECUTE を剥奪。
-- トリガーからの実行は EXECUTE 権限に依存しないため動作に影響しない。
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
