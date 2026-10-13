(function(){
 const CLOUD_KEY='teacherpro-e2e-cloud', SESSION='teacherpro-e2e-email';
 const getCloud=()=>{try{return JSON.parse(localStorage.getItem(CLOUD_KEY)||'{}')}catch{return {}}};
 const setCloud=data=>localStorage.setItem(CLOUD_KEY,JSON.stringify(data));
 const current=()=>{const email=sessionStorage.getItem(SESSION);return email?{id:email==='a@teacherpro.test'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',email}:null};
 let version=0;
 function query(){
  let action='select',payload={},filters={};
  const run=async()=>{
   const cloud=getCloud(),id=filters.user_id||payload.user_id,entry=cloud[id];
   if(action==='insert'){
    if(entry)return {data:null,error:{code:'23505',message:'duplicate key'}};
    const updated_at=new Date(Date.now()+(++version)*1000).toISOString();cloud[id]={payload:payload.payload,updated_at};setCloud(cloud);return {data:{updated_at},error:null};
   }
   if(action==='update'){
    if(!entry||entry.updated_at!==filters.updated_at)return {data:null,error:null};
    const updated_at=new Date(Date.now()+(++version)*1000).toISOString();cloud[id]={payload:payload.payload,updated_at};setCloud(cloud);return {data:{updated_at},error:null};
   }
   return {data:entry||null,error:null};
  };
  const result={select(){return this},eq(k,v){filters[k]=v;return this},insert(v){action='insert';payload=v;return this},update(v){action='update';payload=v;return this},maybeSingle:run,single:run};return result;
 }
 window.supabase={createClient:()=>({auth:{
  getSession:async()=>({data:{session:current()?{user:current()}:null},error:null}),
  getUser:async()=>({data:{user:current()},error:null}),
  signInWithPassword:async({email,password})=>{
   if(!['a@teacherpro.test','b@teacherpro.test'].includes(email)||password!=='DemoPass123')return {error:{message:'Invalid login credentials',code:'invalid_credentials'}};
   sessionStorage.setItem(SESSION,email);return {data:{session:{user:current()}} ,error:null};
  },
  signOut:async()=>{sessionStorage.removeItem(SESSION);return {error:null}},
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
 },from:query})};
})();