// Reminder and change notifications run once per minute independently of command polling.
import {Store,TelegramAPI} from './store.mjs';
import {BotEngine} from './engine.mjs';
import {createTelegramProxyFetch} from './telegram-proxy.mjs';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export async function reminders({engine,log=console}){
  await engine.poll();
  log.log('TELEGRAM_REMINDERS_OK');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const env=process.env;
  const store=new Store(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const telegram=new TelegramAPI(env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_PROXY_URL?createTelegramProxyFetch(env.TELEGRAM_PROXY_URL):fetch);
  const engine=new BotEngine(store,telegram);
  try{await reminders({engine});}
  catch(e){
    // Sanitized error only; never print protected Telegram URL or token.
    console.error('TELEGRAM_REMINDERS_ERROR');
    process.exitCode=1;
  }
}
