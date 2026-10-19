-- TeacherPro Telegram 1.0: additive, isolated integration tables.
-- All original app_data, lessons, subscriptions and payment records remain untouched.
create table if not exists public.tp_telegram_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id text,
  role text not null check (role in ('teacher','student')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role='teacher' and student_id is null) or (role='student' and student_id is not null))
);
create index if not exists tp_telegram_invites_owner_idx on public.tp_telegram_invites(owner_id,created_at desc);
create table if not exists public.tp_telegram_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id text,
  role text not null check (role in ('teacher','student')),
  telegram_user_id bigint not null,
  chat_id bigint not null,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role='teacher' and student_id is null) or (role='student' and student_id is not null))
);
create unique index if not exists tp_telegram_links_unique_active on public.tp_telegram_links(owner_id,role,coalesce(student_id,'')) where status <> 'revoked';
create index if not exists tp_telegram_links_telegram_idx on public.tp_telegram_links(telegram_user_id) where status='active';
create table if not exists public.tp_telegram_prefs (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC',
  reminder_24h boolean not null default true,
  reminder_2h boolean not null default false,
  teacher_digest boolean not null default false,
  digest_time text not null default '08:00' check (digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  changes_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.tp_telegram_delivery (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.tp_telegram_links(id) on delete cascade,
  dedupe_key text not null,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  attempts integer not null default 1,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  unique(link_id,dedupe_key)
);
create table if not exists public.tp_telegram_lesson_state (
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,lesson_id)
);
create table if not exists public.tp_telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);
alter table public.tp_telegram_invites enable row level security;
alter table public.tp_telegram_links enable row level security;
alter table public.tp_telegram_prefs enable row level security;
alter table public.tp_telegram_delivery enable row level security;
alter table public.tp_telegram_lesson_state enable row level security;
alter table public.tp_telegram_processed_updates enable row level security;
revoke all on public.tp_telegram_invites, public.tp_telegram_links, public.tp_telegram_prefs, public.tp_telegram_delivery, public.tp_telegram_lesson_state, public.tp_telegram_processed_updates from anon,authenticated;
grant select on public.tp_telegram_links, public.tp_telegram_prefs to authenticated;
grant all on public.tp_telegram_invites,public.tp_telegram_links,public.tp_telegram_prefs,public.tp_telegram_delivery,public.tp_telegram_lesson_state,public.tp_telegram_processed_updates to service_role;
create policy tp_telegram_links_read on public.tp_telegram_links for select to authenticated using ((select auth.uid())=owner_id);
create policy tp_telegram_prefs_read on public.tp_telegram_prefs for select to authenticated using ((select auth.uid())=owner_id);
create or replace function public.tp_telegram_issue_invite(p_role text,p_student_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); v_raw text; v_student boolean;
begin
  if v_owner is null or p_role not in ('teacher','student') then raise exception 'Not authorized'; end if;
  if p_role='student' then
    if nullif(p_student_id,'') is null then raise exception 'Choose student'; end if;
    select exists (
      select 1 from public.app_data d, jsonb_array_elements(coalesce(d.payload->'clients','[]'::jsonb)) s
      where d.user_id=v_owner and s->>'id'=p_student_id
    ) into v_student;
    if not v_student then raise exception 'Student not found'; end if;
  else
    if p_student_id is not null then raise exception 'Unexpected student'; end if;
  end if;
  if (select count(*) from public.tp_telegram_invites where owner_id=v_owner and created_at>now()-interval '15 minutes') >= 12
    then raise exception 'Too many invitations. Try later'; end if;
  update public.tp_telegram_invites set used_at=now()
    where owner_id=v_owner and role=p_role and student_id is not distinct from p_student_id and used_at is null;
  v_raw := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.tp_telegram_invites(owner_id,student_id,role,token_hash,expires_at)
    values(v_owner,p_student_id,p_role,encode(sha256(convert_to(v_raw,'UTF8')),'hex'),
      now()+case when p_role='teacher' then interval '15 minutes' else interval '48 hours' end);
  return v_raw;
end $$;
create or replace function public.tp_telegram_approve_link(p_link uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.tp_telegram_links set status='active',updated_at=now()
    where id=p_link and owner_id=(select auth.uid()) and role='student' and status='pending';
  return found;
end $$;
create or replace function public.tp_telegram_revoke_link(p_link uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.tp_telegram_links set status='revoked',updated_at=now()
    where id=p_link and owner_id=(select auth.uid()) and status<>'revoked';
  return found;
end $$;
create or replace function public.tp_telegram_set_prefs(
  p_timezone text,p_reminder_24h boolean,p_reminder_2h boolean,
  p_teacher_digest boolean,p_digest_time text,p_changes_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid());
begin
  if v_owner is null then raise exception 'Not authorized'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
     or p_digest_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'Invalid timezone or time'; end if;
  insert into public.tp_telegram_prefs(owner_id,timezone,reminder_24h,reminder_2h,teacher_digest,digest_time,changes_enabled)
    values(v_owner,p_timezone,p_reminder_24h,p_reminder_2h,p_teacher_digest,p_digest_time,p_changes_enabled)
    on conflict(owner_id) do update set timezone=excluded.timezone,reminder_24h=excluded.reminder_24h,
       reminder_2h=excluded.reminder_2h,teacher_digest=excluded.teacher_digest,
       digest_time=excluded.digest_time,changes_enabled=excluded.changes_enabled,updated_at=now();
end $$;
create or replace function public.tp_telegram_redeem(p_raw text,p_tg_id bigint,p_chat_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.tp_telegram_invites%rowtype; v_link public.tp_telegram_links%rowtype;
begin
  if p_raw !~ '^[a-f0-9]{64}$' or p_tg_id<=0 or p_chat_id<>p_tg_id then return jsonb_build_object('status','invalid'); end if;
  select * into v_inv from public.tp_telegram_invites
    where token_hash=encode(sha256(convert_to(p_raw,'UTF8')),'hex')
      and used_at is null and expires_at>now() for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  update public.tp_telegram_invites set used_at=now() where id=v_inv.id;
  update public.tp_telegram_links set status='revoked',updated_at=now()
    where owner_id=v_inv.owner_id and role=v_inv.role
      and student_id is not distinct from v_inv.student_id and status<>'revoked';
  insert into public.tp_telegram_links(owner_id,student_id,role,telegram_user_id,chat_id,status)
    values(v_inv.owner_id,v_inv.student_id,v_inv.role,p_tg_id,p_chat_id,
      case when v_inv.role='teacher' then 'active' else 'pending' end)
    returning * into v_link;
  return jsonb_build_object('status',v_link.status,'link_id',v_link.id,'role',v_link.role);
end $$;
create or replace function public.tp_telegram_claim_delivery(p_link uuid,p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if length(p_key)>250 or length(p_key)<1 then return false; end if;
  insert into public.tp_telegram_delivery(link_id,dedupe_key) values(p_link,p_key)
    on conflict(link_id,dedupe_key) do update set attempts=public.tp_telegram_delivery.attempts+1,
      attempted_at=now(),status='sending',last_error=null
      where (public.tp_telegram_delivery.status='failed' and public.tp_telegram_delivery.attempted_at<now()-interval '2 minutes')
       or (public.tp_telegram_delivery.status='sending' and public.tp_telegram_delivery.attempted_at<now()-interval '5 minutes')
    returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.tp_telegram_issue_invite(text,text),public.tp_telegram_approve_link(uuid),
 public.tp_telegram_revoke_link(uuid),public.tp_telegram_set_prefs(text,boolean,boolean,boolean,text,boolean),
 public.tp_telegram_redeem(text,bigint,bigint),public.tp_telegram_claim_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.tp_telegram_issue_invite(text,text),public.tp_telegram_approve_link(uuid),
 public.tp_telegram_revoke_link(uuid),public.tp_telegram_set_prefs(text,boolean,boolean,boolean,text,boolean) to authenticated;
grant execute on function public.tp_telegram_redeem(text,bigint,bigint),public.tp_telegram_claim_delivery(uuid,text) to service_role;
