// TeacherPro Owner Console API. All platform-wide access is server-side.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const URL = Deno.env.get("SUPABASE_URL") || "";
const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN = createClient(URL, SECRET, {auth:{autoRefreshToken:false,persistSession:false}});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const send = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const must = <T>(r:{data:T,error:unknown})=>{if(r.error)throw r.error;return r.data;};
const list = (obj:unknown)=>Array.isArray(obj)?obj:[];
const num = (v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const cents = (v:unknown)=>Math.round(num(v)*100);
const money = (v:number)=>Math.round(v)/100;
const billable=(s:unknown)=>["done","no_show_charged","cancelled_charged"].includes(String(s));
const price = (l:Record<string,unknown>)=>l.priceUnit==="lesson"?cents(l.hourlyRate):Math.round(cents(l.hourlyRate)*(num(l.duration)||60)/60);
type Row={user_id:string,payload:Record<string,unknown>,updated_at:string};
function summarize(row:Row | undefined,until:string) {
  const data=row?.payload||{},lessons=list(data.lessons) as Record<string,unknown>[],
  payments=list(data.payments) as Record<string,unknown>[], subs=list(data.subscriptions) as Record<string,unknown>[];
  const done=lessons.filter(l=>String(l.date||"")<=until&&l.status==="done");
  const chargeable=lessons.filter(l=>String(l.date||"")<=until&&billable(l.status));
  const earnedFact=chargeable.filter(l=>l.billingMode==="per_lesson").reduce((n,l)=>n+price(l),0);
  const earnedSubs=chargeable.filter(l=>!!l.consumedSubscriptionId).reduce((n,l)=>{
    const sub=subs.find(s=>String(s.id)===String(l.consumedSubscriptionId));
    return n+(sub&&num(sub.total)>0?Math.round(cents(sub.price)/num(sub.total)):0);
  },0);
  const received=payments.filter(p=>p.status==="paid"&&String(p.paidAt||p.date||"")<=until)
    .reduce((n,p)=>n+cents(p.amount),0);
  const name=String((data.settings as Record<string,unknown>|undefined)?.name||"").slice(0,100);
  return {name,students:list(data.clients).length,lessons:lessons.length,
    done:done.length,cancelled:lessons.filter(l=>String(l.date||"")<=until&&["cancelled","cancelled_by_teacher","no_show"].includes(String(l.status))).length,
    earned:money(earnedFact+earnedSubs),received:money(received),
    updatedAt:row?.updated_at||null,unconfirmedSubscriptionHistory:chargeable.filter(l=>l.billingMode==="subscription"&&!l.consumedSubscriptionId).length};
}
async function allPayloads():Promise<Row[]> {
  const rows:Row[]=[];
  for(let from=0;from<10000;from+=500) {
    const batch=must(await ADMIN.from("app_data").select("user_id,payload,updated_at").order("user_id").range(from,from+499)) as Row[];
    rows.push(...batch);
    if(batch.length<500)break;
  }
  return rows;
}
async function allUsers(){
  const result:{id:string,email?:string,created_at?:string,last_sign_in_at?:string}[]=[];
  for(let page=1;page<=20;page++){
    const {data,error}=await ADMIN.auth.admin.listUsers({page,perPage:500});
    if(error)throw error;
    result.push(...(data?.users||[]));
    if((data?.users||[]).length<500)break;
  }
  return result;
}
async function audit(uid:string,action:string,target="",details:Record<string,unknown>={}){
  const {error}=await ADMIN.from("tp_admin_audit").insert({actor_id:uid,action,target,details});
  if(error)throw error;
}
function safeStr(v:unknown,max=150){return String(v??"").trim().slice(0,max);}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="POST")return send({error:"Method not allowed"},405);
  if(!URL||!SECRET)return send({error:"Server is not configured"},503);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return send({error:"Authentication required"},401);
  try{
    const {data:session,error:authError}=await ADMIN.auth.getUser(token);
    if(authError||!session?.user?.id)return send({error:"Session expired"},401);
    const uid=session.user.id;
    const role=must(await ADMIN.from("tp_platform_admins").select("role").eq("user_id",uid).maybeSingle()) as {role:string}|null;
    if(!role||!["owner","admin"].includes(role.role))return send({error:"Access denied"},403);
    const input=await req.text();
    if(input.length>12000)return send({error:"Request too large"},413);
    const arg=JSON.parse(input||"{}");
    const action=safeStr(arg.action,60);
    const until=new Date().toISOString().slice(0,10);
    if(action==="overview"||action==="teachers"){
      const [users,rows,controls,admins]=await Promise.all([
        allUsers(), allPayloads(),
        ADMIN.from("tp_teacher_control").select("user_id,status,plan_code,updated_at").then(must),
        ADMIN.from("tp_platform_admins").select("user_id,role").then(must)
      ]);
      const adminsSet=new Set((admins as {user_id:string}[]).map(x=>x.user_id));
      const byRow=new Map(rows.map(x=>[x.user_id,x]));
      const byControl=new Map((controls as {user_id:string,status:string,plan_code:string}[]).map(x=>[x.user_id,x]));
      const teachers=users.filter(u=>!adminsSet.has(u.id)).map(u=>{
        const s=summarize(byRow.get(u.id),until),c=byControl.get(u.id);
        return {id:u.id,email:u.email||"",createdAt:u.created_at,lastSignInAt:u.last_sign_in_at,
          status:c?.status||"active",plan:c?.plan_code||"free",...s};
      });
      if(action==="teachers")return send({teachers});
      const sum=(key:"students"|"done"|"earned"|"received")=>teachers.reduce((n,t)=>n+num(t[key]),0);
      const cutoff=Date.now()-7*86400000;
      const active7d=teachers.filter(t=>t.lastSignInAt&&Date.parse(t.lastSignInAt)>=cutoff).length;
      const alerts=must(await ADMIN.from("tp_support_tickets").select("id",{count:"exact",head:true}).neq("status","resolved")) as unknown;
      const ticketCount=(alerts as {length?:number})?.length||0;
      return send({overview:{teachers:teachers.length,active7d,students:sum("students"),done:sum("done"),
        earned:sum("earned"),received:sum("received"),suspended:teachers.filter(t=>t.status==="suspended").length,
        supportOpen:ticketCount,updatedAt:new Date().toISOString()},recent:teachers.slice(0,8)});
    }
    if(action==="teacher_detail"){
      const id=safeStr(arg.id,40);
      if(!UUID.test(id))return send({error:"Invalid ID"},400);
      const row=must(await ADMIN.from("app_data").select("user_id,payload,updated_at").eq("user_id",id).maybeSingle()) as Row|null;
      const {data:account,error}=await ADMIN.auth.admin.getUserById(id);
      if(error)return send({error:"Not found"},404);
      const summary=summarize(row||undefined,until);
      return send({teacher:{id,email:account.user?.email||"",createdAt:account.user?.created_at||null,...summary},
        note:"Просмотр персональных карточек учеников без согласия преподавателя недоступен."});
    }
    if(action==="teacher_status"||action==="teacher_plan"){
      const id=safeStr(arg.id,40);
      if(!UUID.test(id)||id===uid)return send({error:"Invalid teacher"},400);
      const targetAdmin=must(await ADMIN.from("tp_platform_admins").select("user_id").eq("user_id",id).maybeSingle());
      if(targetAdmin)return send({error:"Cannot edit an administrator"},403);
      const {data:user,error:missing}=await ADMIN.auth.admin.getUserById(id);
      if(missing||!user?.user)return send({error:"Teacher does not exist"},404);
      const payload:Record<string,unknown>={user_id:id,updated_at:new Date().toISOString()};
      if(action==="teacher_status"){
        const status=safeStr(arg.status,15);
        if(!["active","suspended"].includes(status))return send({error:"Invalid status"},400);
        payload.status=status;
      } else {
        const plan=safeStr(arg.plan,30);
        const valid=must(await ADMIN.from("tp_platform_plans").select("code").eq("code",plan).eq("enabled",true).maybeSingle());
        if(!valid)return send({error:"Plan unavailable"},400);
        payload.plan_code=plan;
      }
      must(await ADMIN.from("tp_teacher_control").upsert(payload,{onConflict:"user_id"}));
      await audit(uid,action,id,{value:payload.status||payload.plan_code});
      return send({ok:true});
    }
    if(action==="flags"){
      const flags=must(await ADMIN.from("tp_platform_flags").select("key,enabled,description,value,updated_at").order("key"));
      return send({flags});
    }
    if(action==="flag_set"){
      const key=safeStr(arg.key,60),value=safeStr(arg.value,240);
      if(!["support_requests","maintenance_banner"].includes(key)||typeof arg.enabled!=="boolean")
        return send({error:"Invalid setting"},400);
      must(await ADMIN.from("tp_platform_flags").update({enabled:arg.enabled,value,updated_at:new Date().toISOString()}).eq("key",key));
      await audit(uid,"flag_set",key,{enabled:arg.enabled,value});
      return send({ok:true});
    }
    if(action==="plans"){
      const plans=must(await ADMIN.from("tp_platform_plans").select("*").order("price_rub"));
      return send({plans});
    }
    if(action==="plan_save"){
      const code=safeStr(arg.code,30),title=safeStr(arg.title,80);
      const sum=num(arg.price),max=num(arg.max_students),period=safeStr(arg.period,10);
      if(!/^[a-z][a-z0-9_]{1,29}$/.test(code)||title.length<2||
        !["month","year","manual"].includes(period)||!Number.isInteger(max)||max<0||max>100000||
        sum<0||sum>1000000||Math.round(sum*100)!==sum*100||typeof arg.enabled!=="boolean"||
        (code==="free"&&sum!==0))return send({error:"Invalid plan"},400);
      must(await ADMIN.from("tp_platform_plans").upsert({code,title,period,price_rub:sum,max_students:max,
        enabled:arg.enabled,updated_at:new Date().toISOString()},{onConflict:"code"}));
      await audit(uid,"plan_save",code,{title,period,price:sum,enabled:arg.enabled});
      return send({ok:true});
    }
    if(action==="support"){
      const tickets=must(await ADMIN.from("tp_support_tickets").select("id,teacher_id,category,subject,message,status,created_at,updated_at").order("created_at",{ascending:false}).limit(100));
      return send({tickets});
    }
    if(action==="ticket_status"){
      const id=safeStr(arg.id,40),status=safeStr(arg.status,20);
      if(!UUID.test(id)||!["new","in_progress","resolved"].includes(status))return send({error:"Invalid ticket update"},400);
      const row=must(await ADMIN.from("tp_support_tickets").update({status,updated_at:new Date().toISOString()}).eq("id",id).select("id").maybeSingle());
      if(!row)return send({error:"Ticket not found"},404);
      await audit(uid,"ticket_status",id,{status});
      return send({ok:true});
    }
    if(action==="system"){
      const [links,deliveries,flags]=await Promise.all([
        ADMIN.from("tp_telegram_links").select("status"),
        ADMIN.from("tp_telegram_delivery").select("status"),
        ADMIN.from("tp_platform_flags").select("key,enabled")
      ]);
      for(const x of [links,deliveries,flags])if(x.error)throw x.error;
      const items=(deliveries.data||[]) as {status:string}[];
      return send({system:{telegramLinked:(links.data||[]).filter((x:{status:string})=>x.status==="active").length,
        sent:items.filter(x=>x.status==="sent").length,failed:items.filter(x=>x.status==="failed").length,
        flags:flags.data,checkedAt:new Date().toISOString()}});
    }
    if(action==="audit"){
      const items=must(await ADMIN.from("tp_admin_audit").select("id,action,target,details,created_at").order("created_at",{ascending:false}).limit(100));
      return send({items});
    }
    return send({error:"Unknown action"},400);
  }catch(e){
    console.error("TeacherPro admin request failed",String((e as Error)?.message||e).slice(0,180));
    return send({error:"Не удалось выполнить запрос. Проверь серверные журналы."},500);
  }
});
