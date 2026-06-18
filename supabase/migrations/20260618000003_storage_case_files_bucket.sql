-- private バケット case-files
insert into storage.buckets (id, name, public)
values ('case-files', 'case-files', false)
on conflict (id) do nothing;

-- パス規約 {user_id}/{case_id}/{filename}。先頭フォルダ = 自分の user_id のみ操作可
create policy "case_files_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'case-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "case_files_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'case-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "case_files_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'case-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'case-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "case_files_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'case-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
