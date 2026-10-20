// Safely convert a private user-supplied VLESS URI into a loopback-only Xray client.
// Never log URI data, proxy address, UUID, Reality public key or generated config.
import {readFileSync,writeFileSync} from 'node:fs';

const allowedTransport=new Set(['tcp','ws','grpc','xhttp']);
const allowedSecurity=new Set(['tls','reality','none']);
function required(s){return typeof s==='string'&&s.length>0;}
function limited(s,max=1024){return typeof s==='string'&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s);}
function hostnameValid(name){return limited(name,253)&&required(name)&&!/[ /@#]/.test(name);}
function pathValid(path){return limited(path,1024)&&path.startsWith('/');}
function pick(q,k){return q.get(k)||'';}

export function vlessToXray(raw){
 if(typeof raw!=='string'||raw.length>8192||!raw.startsWith('vless://'))
   throw Error('Invalid or unsupported QuattroVPN connection format');
 let uri;
 try{uri=new URL(raw.trim());}catch{throw Error('Invalid or unsupported QuattroVPN connection format');}
 const q=uri.searchParams;
 const uuid=decodeURIComponent(uri.username||'');
 const address=uri.hostname;
 const port=Number(uri.port);
 const network=pick(q,'type')||'tcp';
 const security=pick(q,'security')||'none';
 const encryption=pick(q,'encryption')||'none';
 if(uri.protocol!=='vless:'||!required(address)||!hostnameValid(address)||
    !/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(uuid)||
    !(port>=1&&port<=65535)||!Number.isInteger(port)||uri.password||
    !allowedTransport.has(network)||!allowedSecurity.has(security)||encryption!=='none'){
   throw Error('Unsupported QuattroVPN VLESS settings');
 }
 const user={id:uuid,encryption:'none'};
 const flow=pick(q,'flow');
 if(flow){
   if(flow!=='xtls-rprx-vision'||network!=='tcp'||security==='none')
     throw Error('Unsupported QuattroVPN flow');
   user.flow=flow;
 }
 const streamSettings={network,security};
 if(network==='ws'){
   const path=pick(q,'path')||'/';
   if(!pathValid(path))throw Error('Unsupported QuattroVPN WebSocket path');
   const host=pick(q,'host');
   if(host&&!hostnameValid(host))throw Error('Invalid QuattroVPN WebSocket host');
   streamSettings.wsSettings={path,...(host?{headers:{Host:host}}:{})};
 }
 if(network==='grpc'){
   const serviceName=pick(q,'serviceName');
   if(!limited(serviceName,256))throw Error('Unsupported QuattroVPN gRPC service');
   streamSettings.grpcSettings={serviceName};
 }
 if(network==='xhttp'){
   const path=pick(q,'path')||'/';
   if(!pathValid(path))throw Error('Unsupported QuattroVPN XHTTP path');
   const host=pick(q,'host');
   if(host&&!hostnameValid(host))throw Error('Invalid QuattroVPN XHTTP host');
   streamSettings.xhttpSettings={path,...(host?{host}:{})};
 }
 const sni=pick(q,'sni')||address,fp=pick(q,'fp')||'chrome';
 if(!hostnameValid(sni)||!limited(fp,48))throw Error('Invalid QuattroVPN TLS settings');
 if(security==='tls'){
   const alpn=pick(q,'alpn');
   streamSettings.tlsSettings={
     serverName:sni,fingerprint:fp,allowInsecure:false,
     ...(alpn?{alpn:alpn.split(',').slice(0,5)}:{})
   };
 }
 if(security==='reality'){
   const pbk=pick(q,'pbk');
   const sid=pick(q,'sid');
   const spx=pick(q,'spx')||'/';
   if(!/^[A-Za-z0-9_-]{40,64}$/.test(pbk)||
      !/^[0-9a-fA-F]{0,16}$/.test(sid)||!pathValid(spx))
      throw Error('Invalid QuattroVPN Reality settings');
   streamSettings.realitySettings={
     serverName:sni,fingerprint:fp,publicKey:pbk,shortId:sid,spiderX:spx
   };
 }
 return {
   log:{loglevel:'error'},
   inbounds:[{tag:'telegram-local',listen:'127.0.0.1',port:10808,
     protocol:'socks',settings:{auth:'noauth',udp:false}}],
   outbounds:[
     {tag:'deny-all',protocol:'blackhole'},
     {tag:'telegram-tunnel',protocol:'vless',settings:{vnext:[{
       address,port,users:[user]
     }]},streamSettings}
   ],
   routing:{domainStrategy:'AsIs',rules:[
     {type:'field',inboundTag:['telegram-local'],
       domain:['full:api.telegram.org'],outboundTag:'telegram-tunnel'}
   ]}
 };
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try {
   const raw=process.env.QUATTRO_VLESS_URI;
   const config=vlessToXray(raw);
   const dest=process.env.XRAY_PRIVATE_CONFIG_FILE;
   if(!dest||!dest.startsWith('/'))throw Error('Missing private output file');
   writeFileSync(dest,JSON.stringify(config)+'\n',{mode:0o600,flag:'w'});
   console.log('QUATTRO_VLESS_CONFIG_PREPARED');
 }catch{
   console.error('QUATTRO_VLESS_URI_INVALID_OR_UNSUPPORTED');
   process.exitCode=1;
 }
}
