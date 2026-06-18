-- 全テーブルで RLS 有効化
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_files enable row level security;
alter table public.messages enable row level security;
alter table public.case_artifacts enable row level security;

-- profiles: 本人のみ参照・更新（insert は handle_new_user トリガーが security definer で行う）
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- cases: 本人のデータのみ all
create policy "cases_all_own" on public.cases
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- case_files: 親 cases 経由で owner 判定
create policy "case_files_all_own" on public.case_files
  for all
  using (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())));

-- messages: 親 cases 経由で owner 判定
create policy "messages_all_own" on public.messages
  for all
  using (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())));

-- case_artifacts: 親 cases 経由で owner 判定
create policy "case_artifacts_all_own" on public.case_artifacts
  for all
  using (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.cases c where c.id = case_id and c.user_id = (select auth.uid())));
