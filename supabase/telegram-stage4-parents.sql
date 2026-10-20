-- TeacherPro Telegram stage 4: guardian access to a specific child.
-- All existing teacher/student links and invites remain valid and unchanged.
alter table public.tp_telegram_invites drop constraint tp_telegram_invites_role_check;
alter table public.tp_telegram_invites add constraint tp_telegram_invites_role_check
  check (role in ('teacher','student','parent'));
alter table public.tp_telegram_invites drop constraint tp_telegram_invites_check;
alter table public.tp_telegram_invites add constraint tp_telegram_invites_check
  check ((role='teacher' and student_id is null) or
         (role in ('student','parent') and student_id is not null));
alter table public.tp_telegram_links drop constraint tp_telegram_links_role_check;
alter table public.tp_telegram_links add constraint tp_telegram_links_role_check
  check (role in ('teacher','student','parent'));
alter table public.tp_telegram_links drop constraint tp_telegram_links_check;
alter table public.tp_telegram_links add constraint tp_telegram_links_check
  check ((role='teacher' and student_id is null) or
         (role in ('student','parent') and student_id is not null));

create or replace function public.tp_telegram_issue_invite(p_role text,p_student_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); v_raw text; v_student boolean;
begin
 if v_owner is null or p_role not in ('teacher','student','parent') then
   raise exception 'Not authorized';
 end if;
 if p_role in ('student','parent') then
   if nullif(p_student_id,'') is null then raise exception 'Choose student'; end if;
   select exists (
     select 1 from public.app_data d, jsonb_array_elements(
       case when jsonb_typeof(d.payload->'clients')='array' then d.payload->'clients'
         else '[]'::jsonb end) s
     where d.user_id=v_owner and s->>'id'=p_student_id
   ) into v_student;
   if not v_student then raise exception 'Student not found'; end if;
 else
   if p_student_id is not null then raise exception 'Unexpected student'; end if;
 end if;
 if (select count(*) from public.tp_telegram_invites
   where owner_id=v_owner and created_at>now()-interval '15 minutes')>=12
 then raise exception 'Too many invitations. Try later';end if;
 update public.tp_telegram_invites set used_at=now()
 where owner_id=v_owner and role=p_role and student_id is not distinct from p_student_id
 and used_at is null;
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
 where id=p_link and owner_id=(select auth.uid())
 and role in ('student','parent') and status='pending';
 return found;
end $$;
revoke all on function public.tp_telegram_issue_invite(text,text),
  public.tp_telegram_approve_link(uuid) from public,anon,authenticated;
grant execute on function public.tp_telegram_issue_invite(text,text),
  public.tp_telegram_approve_link(uuid) to authenticated;
