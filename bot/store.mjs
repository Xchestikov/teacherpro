// TeacherPro Telegram server-side Supabase adapter; never import this from a browser.
export class Store {
 constructor(url,key,fetcher=fetch){
   if(!/^https:\/\//.test(url||'')||!key)throw new Error('Supabase server credentials not set');
   this.url=url.replace(/\/$/,'');this.key=key;this.fetcher=fetcher;
 }
 async request(method,path,{params={},body,prefer}={}){
   const u=new URL(this.url+'/rest/v1/'+path);
   for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
   const headers={apikey:this.key,Authorization:'Bearer '+this.key,Accept:'application/json'};
   if(body!==undefined)headers['Content-Type']='application/json';
   if(prefer)headers.Prefer=prefer;
   const res=await this.fetcher(u,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
   const txt=await res.text();
   if(!res.ok)throw new Error('Supabase operation '+path+' failed: HTTP '+res.status);
   return txt?JSON.parse(txt):null;
 }
 rows(name,params){return this.request('GET',name,{params});}
 rpc(name,args){return this.request('POST','rpc/'+name,{body:args});}
 insert(name,body,prefer='return=representation'){return this.request('POST',name,{body,prefer});}
 update(name,id,patch){return this.request('PATCH',name,{params:{id:'eq.'+id},body:patch,prefer:'return=representation'});}
 async app(owner){const x=await this.rows('app_data',{user_id:'eq.'+owner,select:'payload',limit:1});return x?.[0]?.payload||{};}
 async connections(params={}){return this.rows('tp_telegram_links',{select:'*',...params,limit:1000});}
 async prefs(owner){const x=await this.rows('tp_telegram_prefs',{owner_id:'eq.'+owner,select:'*',limit:1});
   return x?.[0]||{owner_id:owner,timezone:'UTC',reminder_24h:true,reminder_2h:false,teacher_digest:false,digest_time:'08:00',changes_enabled:true};}
 async claim(link,key){return (await this.rpc('tp_telegram_claim_delivery',{p_link:link,p_key:key}))===true;}
 async deliveryStatus(link,key,status,error=''){
   return this.request('PATCH','tp_telegram_delivery',{params:{link_id:'eq.'+link,dedupe_key:'eq.'+key},body:{
     status,last_error:error.slice(0,160)||null,...(status==='sent'?{sent_at:new Date().toISOString()}: {})
   }});
 }
 async claimUpdate(id){
   const arr=await this.insert('tp_telegram_processed_updates',{update_id:id},'resolution=ignore-duplicates,return=representation');
   return Array.isArray(arr)&&arr.length===1;
 }
 async releaseUpdate(id){return this.request('DELETE','tp_telegram_processed_updates',{params:{update_id:'eq.'+id}});}
 async snapshots(owner){
   return this.rows('tp_telegram_lesson_state',{owner_id:'eq.'+owner,select:'lesson_id,state',limit:1000});
 }
 async snapshot(owner,lessonId,state){
   return this.insert('tp_telegram_lesson_state',{owner_id:owner,lesson_id:String(lessonId),state,updated_at:new Date().toISOString()},
     'resolution=merge-duplicates,return=minimal');
 }
 async redeem(token,user,chat){return this.rpc('tp_telegram_redeem',{p_raw:token,p_tg_id:user,p_chat_id:chat});}
}
export class TelegramAPI {
 constructor(token,fetcher=fetch){
   if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token||''))throw new Error('Invalid Telegram bot token');
   this.token=token;this.fetcher=fetcher;
 }
 async call(method,body){
   const res=await this.fetcher('https://api.telegram.org/bot'+this.token+'/'+method,{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
     signal:AbortSignal.timeout(12000)});
   const data=await res.json();
   if(!res.ok||!data.ok)throw new Error('Telegram '+method+' HTTP '+res.status+' '+String(data.description||'').slice(0,80));
   return data.result;
 }
 message(chat,text,inline_keyboard){
   return this.call('sendMessage',{chat_id:chat,text,disable_web_page_preview:true,
     ...(inline_keyboard?{reply_markup:{inline_keyboard}}:{})});
 }
 answer(id){return this.call('answerCallbackQuery',{callback_query_id:id});}
 webhook(url,secret){return this.call('setWebhook',{url,secret_token:secret,
   allowed_updates:['message','callback_query'],max_connections:4,drop_pending_updates:false});}
}
