import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vlessToXray} from './quattro-vless.mjs';

const uuid='f8b8fd7b-2212-43e9-abff-fc1f67a8708e';
const key='A'.repeat(43);
test('Converts TLS/Reality VLESS into localhost SOCKS5 tunnel restricted to Telegram',()=>{
 const input='vless://'+uuid+'@vpn.example.net:443?type=tcp&security=reality&encryption=none'+
   '&pbk='+key+'&sid=0a&fp=chrome&sni=cdn.example.com&spx=%2F&flow=xtls-rprx-vision#name';
 const cfg=vlessToXray(input);
 assert.deepEqual(cfg.inbounds.map(x=>[x.listen,x.port,x.protocol]),[['127.0.0.1',10808,'socks']]);
 assert.equal(cfg.outbounds[0].protocol,'blackhole'); // unmatched destinations never get a proxy route
 assert.equal(cfg.outbounds[1].protocol,'vless');
 assert.equal(cfg.outbounds[1].settings.vnext[0].address,'vpn.example.net');
 assert.equal(cfg.outbounds[1].settings.vnext[0].users[0].id,uuid);
 assert.equal(cfg.outbounds[1].settings.vnext[0].users[0].flow,'xtls-rprx-vision');
 assert.equal(cfg.outbounds[1].streamSettings.realitySettings.publicKey,key);
 assert.deepEqual(cfg.routing.rules[0].domain,['full:api.telegram.org']);
 assert.equal(JSON.stringify(cfg).includes('QUATTRO_VLESS_URI'),false);
});
test('Handles TLS websocket and grpc without disabling certificate checks',()=>{
 const ws=vlessToXray('vless://'+uuid+'@edge.example.com:443?type=ws&security=tls&sni=edge.example.com&host=www.example.com&path=%2Fws');
 assert.equal(ws.outbounds[1].streamSettings.wsSettings.path,'/ws');
 assert.equal(ws.outbounds[1].streamSettings.wsSettings.headers.Host,'www.example.com');
 assert.equal(ws.outbounds[1].streamSettings.tlsSettings.allowInsecure,false);
 const grpc=vlessToXray('vless://'+uuid+'@edge.example.com:443?type=grpc&security=tls&serviceName=hello');
 assert.equal(grpc.outbounds[1].streamSettings.grpcSettings.serviceName,'hello');
 const xhttp=vlessToXray('vless://'+uuid+'@edge.example.com:443?type=xhttp&security=tls&path=%2Fconnect');
 assert.equal(xhttp.outbounds[1].streamSettings.xhttpSettings.path,'/connect');
});
test('Rejects unsupported protocols and broken credentials safely',()=>{
 for(const uri of ['https://subscription.example/user','vless://wrong@edge.example:443?type=tcp','vless://'+uuid+'@edge.example:443?type=quic',
   'vless://'+uuid+'@edge.example:443?security=reality&pbk=invalid',
   'vless://'+uuid+'@edge.example:443?type=ws&path=%0Aevil',
   'vless://'+uuid+'@edge.example:443?type=grpc&flow=xtls-rprx-vision']){
    assert.throws(()=>vlessToXray(uri),/Invalid|Unsupported/);
 }
});
