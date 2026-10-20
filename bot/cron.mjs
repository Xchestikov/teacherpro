// Cron-managed Telegram long polling fallback: no Nginx edits or root access.
// One short run per minute under flock; all credentials supplied by a 0600 env file.
import {Store,TelegramAPI} from './store.mjs';
import {createTelegramProxyFetch} from './telegram-proxy.mjs';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {BotEngine} from './engine.mjs';

export async function processUpdates(store,telegram,engine,{maxBatches=3,log=console}={}){
  const latest=await store.rows('tp_telegram_processed_updates',{
    select:'update_id',order:'update_id.desc',limit:1
  });
  let offset=latest.length?Number(latest[0].update_id)+1:0;
  if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid Telegram update cursor');
  let handled=0;
  for(let batch=0;batch<maxBatches;batch++){
    const updates=await telegram.call('getUpdates',{offset,timeout:0,limit:100,
      allowed_updates:['message','callback_query']});
    if(!Array.isArray(updates))throw new Error('Unexpected Telegram updates format');
    for(const event of updates){
      const id=Number(event?.update_id);
      if(!Number.isSafeInteger(id)||id<offset)continue;
      const claimed=await store.claimUpdate(id);
      if(claimed){
        try{await engine.handle(event);}
        catch(err){
          await store.releaseUpdate(id);
          throw err;
        }
      }
      offset=id+1; handled++;
    }
    if(updates.length<100)break;
  }
  log.log('TELEGRAM_UPDATES_PROCESSED='+handled);
  return handled;
}

export async function runCron({store,telegram,engine,log=console}={}){
  // A webhook would prevent getUpdates and should not be silently removed.
  const status=await telegram.call('getWebhookInfo',{});
  if(status?.url)throw new Error('Telegram webhook configured: polling disabled');
  await processUpdates(store,telegram,engine,{log});
  await engine.poll();
  log.log('TEACHERPRO_CRON_OK');
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const env=process.env;
  const store=new Store(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const telegram=new TelegramAPI(env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_PROXY_URL ? createTelegramProxyFetch(env.TELEGRAM_PROXY_URL) : fetch);
  const engine=new BotEngine(store,telegram);
  try{await runCron({store,telegram,engine});}
  catch(err){
    // Never include secret contents in logs.
    // Errors may contain API URLs with secrets. Report only generic message and
    // machine-readable network cause codes (never raw nested error objects).
    const causes=[err?.cause?.code,...(Array.isArray(err?.cause?.errors)?err.cause.errors.map(x=>x?.code):[])];
    console.error('TEACHERPRO_CRON_ERROR',String(err?.message||'error').replace(/\d+:[A-Za-z0-9_-]+/g,'[redacted]'),
      'NETWORK_CODES='+causes.filter(x=>/^[A-Z][A-Z0-9_]{1,30}$/.test(String(x||''))).join(','));
    process.exitCode=1;
  }
}
