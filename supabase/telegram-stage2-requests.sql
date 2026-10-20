-- TeacherPro Telegram phase 2: requests, not direct schedule/finance mutation.
-- Deployment order: apply this idempotent migration BEFORE deploying the new worker.
create table if not exists public.tp_telegram_lesson_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid not null references public.tp_telegram_links(id) on delete cascade,
  student_id text not null,
  lesson_id text not null,
  kind text not null check (kind in ('cannot_attend','reschedule')),
  status text not null default 'pending' check (status in ('pending','seen','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tp_tg_req_pending_one
on public.tp_telegram_lesson_requests(owner_id,student_id,lesson_id,kind) where status='pending';
create index if not exists tp_tg_req_owner_recent
on public.tp_telegram_lesson_requests(owner_id,created_at desc);
alter table public.tp_telegram_lesson_requests enable row level security;
revoke all on public.tp_telegram_lesson_requests from public,anon,authenticated;
grant select on public.tp_telegram_lesson_requests to authenticated;
grant all on public.tp_telegram_lesson_requests to service_role;
drop policy if exists tp_tg_req_owner_read on public.tp_telegram_lesson_requests;
create policy tp_tg_req_owner_read on public.tp_telegram_lesson_requests
for select to authenticated using ((select auth.uid())=owner_id);

create or replace function public.tp_telegram_request_lesson(
  p_link uuid,p_actor bigint,p_lesson text,p_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.tp_telegram_links%rowtype;v_lesson jsonb;v_existing uuid;v_new uuid;
begin
 if p_actor <= 0 or length(coalesce(p_lesson,'')) not between 1 and 150
    or p_kind not in ('cannot_attend','reschedule') then
   return jsonb_build_object('status','invalid');
 end if;
 select * into v_link from public.tp_telegram_links
 where id=p_link and telegram_user_id=p_actor and chat_id=p_actor
 and role='student' and status='active' for update;
 if not found then return jsonb_build_object('status','forbidden');end if;
 select l into v_lesson
 from public.app_data a, lateral jsonb_array_elements(
   case when jsonb_typeof(a.payload->'lessons')='array'
   then a.payload->'lessons' else '[]'::jsonb end) l
 where a.user_id=v_link.owner_id and l->>'id'=p_lesson
 and l->>'clientId'=v_link.student_id and l->>'status'='planned'
 and l->>'date'>=to_char(now() - interval '1 day','YYYY-MM-DD')
 limit 1;
 if v_lesson is null then return jsonb_build_object('status','lesson_missing');end if;
 if (select count(*) from public.tp_telegram_lesson_requests
   where link_id=p_link and created_at>now()-interval '15 minutes')>=6 then
   return jsonb_build_object('status','rate_limited');
 end if;
 select id into v_existing from public.tp_telegram_lesson_requests
 where owner_id=v_link.owner_id and student_id=v_link.student_id and
   lesson_id=p_lesson and kind=p_kind and status='pending' limit 1;
 if v_existing is not null then
   return jsonb_build_object('status','existing','id',v_existing);
 end if;
 insert into public.tp_telegram_lesson_requests(owner_id,link_id,student_id,lesson_id,kind)
 values(v_link.owner_id,v_link.id,v_link.student_id,p_lesson,p_kind)
 on conflict (owner_id,student_id,lesson_id,kind) where status='pending' do nothing
 returning id into v_new;
 return jsonb_build_object('status',case when v_new is null then 'existing' else 'created' end,
   'id',coalesce(v_new,v_existing),'owner_id',v_link.owner_id);
end $$;

create or replace function public.tp_telegram_decide_request(
 p_request uuid,p_actor bigint,p_decision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;v_row public.tp_telegram_lesson_requests%rowtype;
begin
 if p_actor<=0 or p_decision not in ('seen','declined') then
   return jsonb_build_object('status','forbidden');
 end if;
 select q.* into v_row from public.tp_telegram_lesson_requests q
 where q.id=p_request and q.status='pending' for update;
 if not found then return jsonb_build_object('status','missing');end if;
 select l.owner_id into v_owner from public.tp_telegram_links l
 where l.owner_id=v_row.owner_id and l.role='teacher'
 and l.status='active' and l.telegram_user_id=p_actor and l.chat_id=p_actor
 limit 1;
 if v_owner is null then return jsonb_build_object('status','forbidden');end if;
 update public.tp_telegram_lesson_requests set status=p_decision,updated_at=now()
 where id=p_request;
 return jsonb_build_object('status',p_decision,'student_id',v_row.student_id,
   'lesson_id',v_row.lesson_id,'owner_id',v_row.owner_id,'link_id',v_row.link_id);
end $$;
revoke all on function public.tp_telegram_request_lesson(uuid,bigint,text,text),
  public.tp_telegram_decide_request(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.tp_telegram_request_lesson(uuid,bigint,text,text),
  public.tp_telegram_decide_request(uuid,bigint,text) to service_role;
