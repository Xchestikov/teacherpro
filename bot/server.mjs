import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {Store,TelegramAPI} from './store.mjs';
import {BotEngine} from './engine.mjs';

export function constantEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
export function createWebhookServer(engine,store,secret,{log=console}={}){
 if(!secret||!/^[A-Za-z0-9_-]{16,256}$/.test(secret))
   throw new Error('Missing or invalid Telegram webhook secret');
 return http.createServer(async(req,res)=>{
   if(req.method==='GET'&&req.url==='/healthz'){
     res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok');return;
   }
   if(req.url!=='/telegram/webhook'||req.method!=='POST'){
     res.writeHead(404);res.end();return;
   }
   if(!constantEqual(req.headers['x-telegram-bot-api-secret-token'],secret)){
     res.writeHead(403);res.end();return;
   }
   try{
     let size=0;const chunks=[];
     for await(const chunk of req){
       size+=chunk.length;
       if(size>65536){res.writeHead(413);res.end();return;}
       chunks.push(chunk);
     }
     const update=JSON.parse(Buffer.concat(chunks).toString('utf8'));
     if(!Number.isSafeInteger(update?.update_id)||update.update_id<0){
       res.writeHead(400);res.end();return;
     }
     if(!await store.claimUpdate(update.update_id)){
       res.writeHead(200);res.end('duplicate');return;
     }
     try{await engine.handle(update);}
     catch(err){
       await store.releaseUpdate(update.update_id).catch(()=>{});
       throw err;
     }
     res.writeHead(200);res.end('ok');
   }catch(err){
     log.warn('Telegram update failed: '+String(err?.message||'error').replace(/\d+:[A-Za-z0-9_-]+/g,'[secret]'));
     if(!res.headersSent)res.writeHead(500);
     res.end();
   }
 });
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const env=process.env;
 const port=Number(env.TP_BOT_PORT||3017);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
 const store=new Store(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
 const telegram=new TelegramAPI(env.TELEGRAM_BOT_TOKEN);
 const engine=new BotEngine(store,telegram);
 const app=createWebhookServer(engine,store,env.TELEGRAM_WEBHOOK_SECRET);
 app.listen(port,'127.0.0.1',()=>console.log('TeacherPro Telegram worker listening locally'));
 let busy=false;
 async function check(){
   if(busy)return;
   busy=true;try{await engine.poll()}catch(err){console.warn('Telegram scheduler failed',String(err?.message||'error'))}
   finally{busy=false;}
 }
 // Startup baseline and short-interval worker; no per-student database polling.
 check();
 const timer=setInterval(check,60000);
 const shutdown=()=>{clearInterval(timer);app.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
