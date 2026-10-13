const ROOT=new URL('./',self.registration.scope).pathname;
const CACHE='teacherpro-shell-v2';
const SHELL=['','index.html','style.css','app.js','cloud-config.js','manifest.webmanifest','icon.svg'].map(path=>ROOT+path);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;event.respondWith(fetch(req).then(response=>{if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}return response}).catch(()=>caches.match(req).then(cached=>cached||caches.match(ROOT+'index.html'))))});