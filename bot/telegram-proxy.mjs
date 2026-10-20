// Private Telegram-only egress via an explicitly configured trusted proxy.
// curl is preinstalled on FirstVDS. Secrets go through stdin, NEVER process argv.
import {spawn} from 'node:child_process';

const allowed = new Set(['https:', 'socks5h:']);
function quoted(value) {
 const x=String(value);
 if(/[\x00-\x1f\x7f]/.test(x))throw new Error('Invalid control character in proxy settings');
 return '"' + x.replaceAll('\\','\\\\').replaceAll('"','\\"') + '"';
}
export function telegramProxyConfig(proxyUrl,telegramUrl,body) {
 const p=new URL(proxyUrl),target=new URL(telegramUrl);
 if(!allowed.has(p.protocol)||!p.hostname||p.search||p.hash||(p.pathname&&p.pathname!=='/'))
   throw new Error('Use a trusted HTTPS or SOCKS5H proxy endpoint');
 if(target.protocol!=='https:'||target.hostname!=='api.telegram.org'||target.port)
   throw new Error('Proxy transport is restricted to the official Telegram Bot API');
 if(typeof body!=='string'||body.length>65536)
   throw new Error('Unexpected Telegram request size');
 // Proxy hostname only in the proxy setting; any credentials travel via stdin.
 const host=p.hostname;
 const endpoint=p.protocol+'//'+host+':'+(p.port|| (p.protocol==='https:'?'443':'1080'));
 const config=[
   'url = '+quoted(target.href),
   'request = "POST"',
   'header = "Content-Type: application/json"',
   'data-binary = '+quoted(body),
   'proxy = '+quoted(endpoint),
   'noproxy = ""'
 ];
 if(p.username||p.password){
   config.push('proxy-user = '+quoted(decodeURIComponent(p.username)+':'+decodeURIComponent(p.password)));
 }
 return config.join('\n')+'\n';
}

export function createTelegramProxyFetch(proxyUrl,{spawnFn=spawn,curlBinary='/usr/bin/curl'}={}){
 // Validate the endpoint before any network request.
 telegramProxyConfig(proxyUrl,'https://api.telegram.org/bot0:placeholder/getMe','{}');
 return async function telegramProxyFetch(url,init={}){
   const config=telegramProxyConfig(proxyUrl,url,init.body||'{}');
   return new Promise((resolve,reject)=>{
     const child=spawnFn(curlBinary,[
       '-q','--config','-','--silent','--fail-with-body',
       '--connect-timeout','7','--max-time','15','--noproxy',''
     ],{stdio:['pipe','pipe','pipe']});
     let output='',bytes=0,settled=false;
     const abort=()=>{child.kill('SIGTERM');finish(new Error('Telegram proxy request timed out'));};
     const finish=(err,result)=>{
       if(settled)return;settled=true;
       init.signal?.removeEventListener('abort',abort);
       if(err)reject(err);else resolve(result);
     };
     if(init.signal?.aborted){abort();return;}
     init.signal?.addEventListener('abort',abort,{once:true});
     child.on('error',()=>finish(new Error('Telegram proxy transport unavailable')));
     child.stdout.on('data',chunk=>{
       bytes+=chunk.length;
       if(bytes>2_000_000){child.kill('SIGTERM');finish(new Error('Telegram response exceeded size limit'));}
       else output+=chunk.toString('utf8');
     });
     // Consume error output, but never print it: curl may include sensitive URLs.
     child.stderr.on('data',()=>{});
     child.on('close',code=>{
       if(settled)return;
       if(code!==0)return finish(new Error('Telegram proxy connection failed ('+String(code)+')'));
       let data;
       try{data=JSON.parse(output);}catch{return finish(new Error('Invalid Telegram response through proxy'));}
       finish(null,{ok:!!data.ok,status:data.ok?200:400,json:async()=>data});
     });
     child.stdin.on('error',()=>{});
     child.stdin.end(config);
   });
 };
}
