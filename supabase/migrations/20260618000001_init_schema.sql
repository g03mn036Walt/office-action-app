-- profiles: auth.users と 1:1
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

-- cases: OA 対応案件
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  publication_number text,
  country text,
  title text,
  current_step int not null default 1,
  status text not null default 'active' check (status in ('active','archived')),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- case_files: アップロード文書のメタ＋抽出テキスト
create table public.case_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  doc_role text not null check (doc_role in ('applicant','oa','reference','claims')),
  file_name text not null,
  file_type text,
  storage_path text,
  anthropic_file_id text,
  extracted_text text,
  summary text,
  created_at timestamptz not null default now()
);

-- messages: チャット履歴
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  step_no int,
  content text,
  created_at timestamptz not null default now()
);

-- case_artifacts: 主要成果物の構造化保存
create table public.case_artifacts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('summary','validity','strategies','rep_amendment','full_amendment','opinion','docx')),
  step_no int,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- インデックス
create index idx_cases_user_id on public.cases(user_id);
create index idx_case_files_case_id on public.case_files(case_id);
create index idx_messages_case_id on public.messages(case_id);
create index idx_case_artifacts_case_id on public.case_artifacts(case_id);

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_cases_updated_at
before update on public.cases
for each row execute function public.set_updated_at();

-- サインアップ時に profiles を自動作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
