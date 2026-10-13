const ROOT=new URL('./',self.registration.scope).pathname;
const CACHE='teacherpro-shell-v18';
const PREFIX='teacherpro-shell-v';
const SHELL=['','index.html','style.css','app.js','cloud-config.js','manifest.webmanifest','icon.svg'].map(path=>ROOT+path);
const SHELL_PATHS=new Set(SHELL);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  // Do not cache authentication redirects (?code=...), private endpoints or arbitrary URLs.
  if(url.search||!SHELL_PATHS.has(url.pathname))return;
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
