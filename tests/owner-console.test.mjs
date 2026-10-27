import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/teacherpro-admin/index.ts');
const migration=read('supabase/owner-console.sql');
const privileges=read('supabase/owner-console-permissions.sql');
const frontend=read('admin/admin.js');
const teacher=read('teacherpro-platform.js');
const index=read('index.html');
const workflow=read('.github/workflows/deploy-vps.yml');

test('separate owner and teacher routes with existing teacher UI preserved',()=>{
  assert.match(read('admin/index.html'),/admin\.js/);
  assert.match(index,/teacherpro-platform\.js/);
  assert.match(index,/<div id="app"/);
  assert.match(frontend,/tp_platform_admins/);
  assert.match(teacher,/tpOpenSupport/);
});
test('every admin mutation uses server-side verified owner role',()=>{
  assert.match(edge,/ADMIN\.auth\.getUser\(token\)/);
  assert.match(edge,/ADMIN\.from\("tp_platform_admins"\)/);
  assert.ok(edge.indexOf('tp_platform_admins')<edge.indexOf('if(action==="overview"'));
  assert.match(edge,/teacher_status/);
  assert.match(edge,/teacher_plan/);
  assert.match(edge,/ticket_status/);
  assert.match(edge,/await audit\(/);
  assert.doesNotMatch(frontend,/SERVICE_ROLE_KEY|service_role|sb_secret_/);
  assert.doesNotMatch(teacher,/SERVICE_ROLE_KEY|service_role|sb_secret_/);
});
test('teacher data stays RLS-isolated and privilege escalation unavailable',()=>{
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/tp_admin_read_self/);
  assert.match(migration,/tp_tickets_insert_own/);
  assert.match(migration,/tp_teacher_control/);
  assert.match(migration,/status='suspended'/);
  assert.match(privileges,/revoke all on public\.tp_platform_admins/);
  assert.match(privileges,/grant insert on public\.tp_support_tickets to authenticated/);
});
test('prices stay fixed per lesson, prorated only for hourly mode',()=>{
  const declaration=edge.match(/const price = \(l:Record<string,unknown>\)=>[^;]+;/)?.[0]?.replace('(l:Record<string,unknown>)','(l)');
  assert.ok(declaration,'Price function not found');
  const script='const num=v=>Number(v)||0; const cents=v=>Math.round(num(v)*100);'+declaration+
    ' price({priceUnit:"lesson",hourlyRate:1000,duration:80})';
  assert.equal(runInNewContext(script),100000);
  const hourly='const num=v=>Number(v)||0; const cents=v=>Math.round(num(v)*100);'+declaration+
    ' price({priceUnit:"hour",hourlyRate:1000,duration:80})';
  assert.equal(runInNewContext(hourly),133333);
});
test('all platform static assets are uploaded and health-checked on VPS',()=>{
  for(const file of ['admin/index.html','admin/admin.js','admin/admin.css','teacherpro-platform.js']){
    assert.ok(workflow.includes(file),file+' missing from deploy workflow');
  }
  assert.match(workflow,/node --check admin\/admin\.js/);
  assert.match(workflow,/node --check teacherpro-platform\.js/);
});
test('support requests are owned by teacher and cannot write role tables',()=>{
  assert.match(migration,/teacher_id=\(select auth\.uid\(\)\)/);
  assert.match(migration,/support_requests/);
  assert.doesNotMatch(privileges,/grant insert on public\.tp_platform_admins to authenticated/i);
});
