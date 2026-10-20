// Persistent Telegram long-polling worker: processes commands as soon as they arrive.
// The cron-based reminder worker is intentionally separate.
import {Store,TelegramAPI} from './store.mjs';
import {BotEngine} from './engine.mjs';
import {createTelegramProxyFetch} from './telegram-proxy.mjs';
import {writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export async function getInitialOffset(store){
  const rows=await store.rows('tp_telegram_processed_updates',{
    select:'update_id',order:'update_id.desc',limit:1
  });
  const offset=rows.length?Number(rows[0].update_id)+1:0;
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid Telegram cursor');
  return offset;
}
export async function pollBatch(store,telegram,engine,offset,{timeout=8}={}){
  const updates=await telegram.call('getUpdates',{offset,limit:100,timeout,
    allowed_updates:['message','callback_query']});
  if(!Array.isArray(updates))throw Error('Invalid Telegram update batch');
  for(const event of updates){
    const id=Number(event?.update_id);
    if(!Number.isSafeInteger(id)||id<offset)continue;
    const claimed=await store.claimUpdate(id);
    if(claimed){
      try{await engine.handle(event);}
      catch(e){await store.releaseUpdate(id);throw e;}
    }
    offset=id+1;
  }
  return {offset,count:updates.length};
}
export async function serve({store,telegram,engine,heartbeat,stopped=()=>false,
  delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console}){
  // getUpdates must not run alongside a webhook.
  const hook=await telegram.call('getWebhookInfo',{});
  if(hook?.url)throw Error('Telegram webhook is enabled');
  let offset=await getInitialOffset(store);
  let failures=0;
  log.log('TELEGRAM_FAST_WORKER_READY');
  while(!stopped()){
    try{
      const batch=await pollBatch(store,telegram,engine,offset);
      offset=batch.offset;
      failures=0;
      if(heartbeat)heartbeat();
      if(batch.count)log.log('TELEGRAM_FAST_HANDLED='+batch.count);
    }catch(e){
      failures=Math.min(failures+1,6);
      // Never print nested network errors or URLs containing BotFather tokens.
      log.warn('TELEGRAM_FAST_RETRY_'+failures);
      if(!stopped())await delay(Math.min(1000*2**(failures-1),12000));
    }
  }
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const env=process.env,store=new Store(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const telegram=new TelegramAPI(env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_PROXY_URL?createTelegramProxyFetch(env.TELEGRAM_PROXY_URL):fetch);
  const engine=new BotEngine(store,telegram);
  let stop=false;
  process.on('SIGTERM',()=>{stop=true;});
  process.on('SIGINT',()=>{stop=true;});
  const heartbeat=()=>{
    if(!env.TELEGRAM_HEARTBEAT_FILE)return;
    try{writeFileSync(env.TELEGRAM_HEARTBEAT_FILE,Date.now()+'\n',{mode:0o600});}
    catch{console.warn('TELEGRAM_HEARTBEAT_UNAVAILABLE');}
  };
  try{await serve({store,telegram,engine,heartbeat,stopped:()=>stop});}
  catch{console.error('TELEGRAM_FAST_START_FAILED');process.exitCode=1;}
}
