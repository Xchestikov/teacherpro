import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {telegramProxyConfig,createTelegramProxyFetch} from './telegram-proxy.mjs';

const telegram='https://api.telegram.org/bot111111:sampleSecretKeyString/getUpdates';
test('Only encrypted HTTP proxies and explicit SOCKS5H proxies are accepted',()=>{
 assert.throws(()=>telegramProxyConfig('http://relay.invalid:8080',telegram,'{}'),/trusted HTTPS/);
 assert.throws(()=>telegramProxyConfig('ftp://relay.invalid',telegram,'{}'),/trusted HTTPS/);
 assert.throws(()=>telegramProxyConfig('https://relay.invalid/admin',telegram,'{}'),/trusted HTTPS/);
 assert.throws(()=>telegramProxyConfig('https://relay.invalid', 'https://example.org/bot', '{}'),/official Telegram/);
 assert.match(telegramProxyConfig('https://relay.invalid:8443',telegram,'{}'),/proxy = "https:\/\/relay.invalid:8443"/);
 assert.match(telegramProxyConfig('socks5h:\/\/relay.invalid:1080',telegram,'{}'),/proxy = "socks5h:\/\/relay.invalid:1080"/);
});
test('Credentials, URL path and request body stay in stdin configuration, not argv',async()=>{
 let command,argumentsList,received='';
 const spawnFn=(bin,args)=>{
   command=bin;argumentsList=args;
   const p=new EventEmitter();
   p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();
   p.stdin.on('data',chunk=>{received+=chunk.toString();});
   p.stdin.on('finish',()=>{
     queueMicrotask(()=>{
       p.stdout.write(JSON.stringify({ok:true,result:[{update_id:1}]}));
       p.emit('close',0);
     });
   });
   p.kill=()=>{};
   return p;
 };
 const fetcher=createTelegramProxyFetch('https://reader:p%40ss%3Aword@relay.invalid:8443',{spawnFn});
 const response=await fetcher(telegram,{body:JSON.stringify({offset:3})});
 assert.deepEqual(await response.json(),{ok:true,result:[{update_id:1}]});
 assert.equal(response.status,200);
 assert.equal(command,'/usr/bin/curl');
 assert.equal(argumentsList[0],'-q'); // opt out of untrusted .curlrc
 assert.ok(argumentsList.includes('--config'));
 assert.ok(!argumentsList.join(' ').includes('sampleSecretKeyString'));
 assert.ok(!argumentsList.join(' ').includes('p@ss:word'));
 assert.ok(received.includes('proxy-user = "reader:p@ss:word"'));
 assert.ok(received.includes('data-binary = "{\\"offset\\":3}"'));
 assert.ok(received.includes('url = "https://api.telegram.org/bot'));
});
test('A failed transport emits no secret or internal proxy address',async()=>{
 const spawnFn=()=>{
   const p=new EventEmitter();
   p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();
   p.stdin.on('finish',()=>queueMicrotask(()=>p.emit('close',56)));
   p.kill=()=>{};return p;
 };
 const fetcher=createTelegramProxyFetch('https://private-user:private-pass@relay.invalid:8443',{spawnFn});
 await assert.rejects(fetcher(telegram,{body:'{}'}),e=>{
   assert.match(e.message,/connection failed \(56\)/);
   assert.doesNotMatch(e.message,/private|sampleSecret|relay.invalid/);
   return true;
 });
});
