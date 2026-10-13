-- Ритм / TeacherPro: безопасное облачное хранилище профиля
-- Выполнить один раз в Supabase Dashboard → SQL Editor.

create table if not exists public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

drop policy if exists "Users can read own app data" on public.app_data;
create policy "Users can read own app data"
  on public.app_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own app data" on public.app_data;
create policy "Users can insert own app data"
  on public.app_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own app data" on public.app_data;
create policy "Users can update own app data"
  on public.app_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.app_data to authenticated;

-- Версия записи назначается сервером, а не часами браузера.
-- Выполни скрипт в SQL Editor после обновления frontend.
create or replace function public.teacherpro_touch_app_data()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists teacherpro_app_data_updated_at on public.app_data;
create trigger teacherpro_app_data_updated_at
  before update on public.app_data
  for each row execute function public.teacherpro_touch_app_data();

-- Не разрешаем анонимный доступ к приватным данным.
revoke all on public.app_data from anon;
revoke all on public.app_data from public;
revoke delete on public.app_data from authenticated;
