-- TeacherPro pre-release checks. Read-only, does not change the database.
-- Execute in the SQL Editor of the CORRECT Supabase project.
-- Do not paste user data or tokens into public bug reports.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  has_table_privilege('anon','public.app_data','SELECT') as anon_can_select,
  has_table_privilege('anon','public.app_data','INSERT') as anon_can_insert,
  has_table_privilege('anon','public.app_data','UPDATE') as anon_can_update,
  has_table_privilege('authenticated','public.app_data','SELECT') as authenticated_can_select,
  has_table_privilege('authenticated','public.app_data','INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated','public.app_data','UPDATE') as authenticated_can_update
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='app_data';
-- EXPECT: one row, rls_enabled=true, anon_can_*=false,
-- authenticated_can_*=true.
select policyname,cmd,roles,qual,with_check
from pg_policies
where schemaname='public' and tablename='app_data'
order by policyname;
-- EXPECT: exactly three explicit owner-scoped SELECT / INSERT / UPDATE
-- policies using auth.uid() = user_id; review any additional broad policy.
select trigger_name,event_manipulation,action_timing
from information_schema.triggers
where event_object_schema='public' and event_object_table='app_data'
order by trigger_name;
-- EXPECT: teacherpro_app_data_updated_at on BEFORE UPDATE.
select count(*) as rows_total,count(distinct user_id) as distinct_owners
from public.app_data;
-- NEVER share payload content when reporting these counts.
