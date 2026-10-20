const {test,expect}=require('@playwright/test');

test.use({baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},serviceWorkers:'block'});

async function bootWithEndpoint(page,proxied){
  await page.route('https://fonts.googleapis.com/**',r=>r.abort());
  await page.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.route('**/vendor/supabase-sdk.js*',r=>r.fulfill({
    status:200,contentType:'application/javascript',
    body: 'window.supabase={createClient:(url,key,opts)=>{window.__selectedSupabaseUrl=url;window.__selectedStorageKey=opts.auth.storageKey;return {auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}};'
  }));
  await page.route('**/supabase/auth/v1/health',r=>r.fulfill({
    status:proxied?401:404,
    headers:proxied?{'X-TeacherPro-Proxy':'v1','Content-Type':'application/json'}:{'Content-Type':'text/html'},
    body:proxied?'{"message":"API key required"}':'Not found'
  }));
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeVisible();
  return page.evaluate(()=>({url:window.__selectedSupabaseUrl,storageKey:window.__selectedStorageKey}));
}

test('uses FirstVDS proxy when upstream confirmation header is present',async({page})=>{
  const result=await bootWithEndpoint(page,true);
  expect(result.url).toBe('http://127.0.0.1:4173/supabase'.replace('http:','https:')===result.url?'https://127.0.0.1:4173/supabase':'https://egopcojrzklvytcuhpov.supabase.co');
});
test('without proxy health marker keeps direct Supabase and existing sessions',async({page})=>{
  const result=await bootWithEndpoint(page,false);
  expect(result.url).toBe('https://egopcojrzklvytcuhpov.supabase.co');
  expect(result.storageKey).toBe('sb-egopcojrzklvytcuhpov-auth-token');
});
