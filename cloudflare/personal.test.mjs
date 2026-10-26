import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {Miniflare,Response as MFResponse} from 'miniflare';
import {createPersonalForgeWorker} from './personal-worker.mjs';
const password='synthetic-forge-password-only';
const basic=(passwordValue=password,username='forge')=>'Basic '+Buffer.from(username+':'+passwordValue,'utf8').toString('base64');
const root=resolve('cloudflare-dist');
test('Personal Cloudflare package requires only DB and a Forge password, with authenticated storage and failed-login throttling',async()=>{
 let outbound=0;
 const runtime=new Miniflare({modulesRoot:root,modules:[{type:'ESModule',path:resolve(root,'_worker.js')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings:{FORGE_PASSWORD:password},d1Databases:['DB'],r2Buckets:['BUCKET'],r2Persist:resolve('.wrangler/test-r2'),serviceBindings:{ASSETS:async()=>new MFResponse('asset')},outboundService:async()=>{outbound++;return new MFResponse('No external identity service required',{status:503})}});
 try{
  const request=(path,init={})=>runtime.dispatchFetch('https://forge.test'+path,init);
  const headers={Authorization:basic(),'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'};
  const unauth=await request('/');assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate'),/^Basic realm="Forge"/);
  assert.equal((await request('/api/records',{headers:{'oai-authenticated-user-id':'forge-personal-owner','oai-authenticated-user-email':'owner@forge.local'}})).status,401);
  assert.equal((await request('/api/records',{headers:{...headers,Authorization:basic('incorrect-password')}})).status,401);
  assert.equal((await request('/api/records',{headers:{...headers,Authorization:basic(password,'another-user')}})).status,401);
  const home=await request('/',{headers});assert.equal(home.status,200);assert.match(await home.text(),/Forge/);assert.match(home.headers.get('cache-control'),/no-store/);
  const snapshot={id:'personal-session',name:'Historical Planfit workout',date:'2026-10-20',startedAt:'2026-10-20T09:00:00.000Z',finishedAt:'2026-10-20T09:25:00.000Z',duration:25,exercises:[{id:'walk',exerciseId:'walking',name:'Walking',sets:[{id:'set-1',weight:null,reps:null,durationSec:1500,completed:true,type:'Working'}]}],pbs:[],volume:0};
  const record={kind:'session',id:snapshot.id,key:'session:'+snapshot.id,revision:'test',data:snapshot};
  const response=await request('/api/records',{method:'POST',headers,body:JSON.stringify({records:[record]})});assert.equal(response.status,200);
  const saved=await(await request('/api/records',{headers})).json();assert.deepEqual(saved.records[0].data,snapshot);
  assert.equal((await request('/api/records',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:JSON.stringify({records:[record]})})).status,403);
  const db=await runtime.getD1Database('DB');const row=await db.prepare('SELECT user_id FROM training_records LIMIT 1').first();assert.equal(row.user_id,'forge-personal-owner');
  const echo=createPersonalForgeWorker({fetch:async request=>MFResponse.json(Object.fromEntries(request.headers))},[]);
  const identity=await(await echo.fetch(new Request('https://forge.test/',{headers:{...headers,'oai-authenticated-user-id':'victim','oai-authenticated-user-full-name':'spoofed'}}),{DB:db,FORGE_PASSWORD:password},{})).json();
  assert.equal(identity['oai-authenticated-user-id'],'forge-personal-owner');assert.equal(identity.authorization,undefined);assert.equal(identity['oai-authenticated-user-full-name'],undefined);
  const rateHeaders={...headers,'CF-Connecting-IP':'192.0.2.2',Authorization:basic('wrong-password')};
  for(let i=0;i<5;i++)assert.equal((await request('/api/records',{headers:rateHeaders})).status,401);
  const blocked=await request('/api/records',{headers:{...rateHeaders,Authorization:basic()}});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  await db.prepare('UPDATE forge_login_limits SET reset_at = 0').run();assert.equal((await request('/api/records',{headers:{...rateHeaders,Authorization:basic()}})).status,200);
  const photo=Uint8Array.from([137,80,78,71,13,10,26,10]);assert.equal((await request('/api/photos/photo',{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:photo})).status,200);assert.deepEqual(new Uint8Array(await(await request('/api/photos/photo',{headers})).arrayBuffer()),photo);
  assert.equal(outbound,0);
 }finally{await runtime.dispose()}
});
test('Missing or short personal password stays closed and shows a one-secret setup guide',async()=>{
 const worker=createPersonalForgeWorker({fetch:()=>new Response('private')},[]);
 for(const env of [{},{DB:{},FORGE_PASSWORD:'short'}]){
  const response=await worker.fetch(new Request('https://forge.test/'),env,{});assert.equal(response.status,503);const html=await response.text();assert.match(html,/FORGE_PASSWORD/);assert.doesNotMatch(html,/TEAM_DOMAIN|POLICY_AUD/);
 }
});
