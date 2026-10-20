const ROOT=new URL('./',self.registration.scope).pathname;
const CACHE='teacherpro-shell-v44';
const PREFIX='teacherpro-shell-v';
const SHELL=['','index.html','style.css','app.js','cloud-multisession.js','calendar-stage1.js','soft-editorial.js','soft-editorial.css','teacherpro-polish.js','teacherpro-polish.css','calendar-v2.js','calendar-v2.css','finance-v2.js?v=20261019-pricing-v1','finance-v2.css','finance-v3-core.js?v=20261019-pricing-v1','finance-v3-lessons.js?v=20261019-pricing-v1','finance-v3-ledger.js','finance-v3-edit.js','finance-v3-void.js','finance-v3-new-payment.js','finance-v3-edit-form.js','finance-v3-payments-view.js?v=20261019-pricing-v1','finance-v3.css','schedule-series.js?v=20261019-pricing-v1','schedule-series.css','student-v2.js','student-v2.css','mobile-ui-v2.js','mobile-ui-v2.css','calendar-colors.css','calendar-colors.js','telegram-config.js?v=20261019-tg1','telegram-ui.js?v=20261019-tg1','assets/studio-botanical.svg','assets/studio-mark.svg','cloud-config.js','vendor/supabase-sdk.js?v=20261020','manifest.webmanifest','icon.svg'].map(path=>ROOT+path);
const SHELL_PATHS=new Set(SHELL);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  // Do not cache authentication redirects (?code=...), private endpoints or arbitrary URLs.
  // Only allow the exact versioned shell assets; auth query strings are never cached.
  if(!SHELL_PATHS.has(url.pathname+url.search))return;
  event.respondWith(fetch(req).then(response=>{
    if(response&&response.ok&&response.type!=='opaque'){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));
    }
    return response;
  }).catch(async()=>{
    const cached=await caches.match(req);
    if(cached)return cached;
    if(req.mode==='navigate')return caches.match(ROOT+'index.html');
    return Response.error();
  }));
});
