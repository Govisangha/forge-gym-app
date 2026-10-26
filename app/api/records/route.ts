import {getChatGPTUser} from '../../chatgpt-auth';
import {recordDB} from '@/db/records';
import {env} from 'cloudflare:workers';

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Sign in required'},{status:401});
  try{
    const after=new URL(request.url).searchParams.get('after')??'';
    const rows=await recordDB().prepare('SELECT record_key, payload FROM training_records WHERE user_id = ? AND record_key > ? ORDER BY record_key LIMIT 201').bind(user.userId,after).all<{record_key:string;payload:string}>();
    const page=rows.results.slice(0,200);
    return Response.json({records:page.map(x=>JSON.parse(x.payload)),next:rows.results.length>200?page.at(-1)?.record_key:null},{headers:{'Cache-Control':'no-store'}});
  }catch(e){console.error('History read failed',e);return Response.json({error:'Cloud history unavailable; your device copy is safe.'},{status:503})}
}

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Sign in required'},{status:401});
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
  try{
    const raw=await request.text();
    if(raw.length>5_000_000)return Response.json({error:'Batch too large'},{status:413});
    const body=JSON.parse(raw);
    if(!Array.isArray(body.records)||body.records.length>40||!body.records.length)return Response.json({error:'Invalid batch'},{status:400});
    const allowed=['settings','programme','exercise','session','weight','measurement','photo','import-batch','import-source'];
    for(const r of body.records){
      if(!allowed.includes(r.kind)||typeof r.id!=='string'||!/^[\w-]{1,100}$/.test(r.id)||r.key!==r.kind+':'+r.id||!r.data||r.data.id!==r.id||typeof r.revision!=='string')return Response.json({error:'Invalid record'},{status:400});
      if(r.kind==='session'&&(!Array.isArray(r.data.exercises)||!r.data.finishedAt))return Response.json({error:'Only complete snapshots can be backed up'},{status:400});
      if(r.kind==='photo'&&r.data.dataUrl){
        const match=r.data.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if(!match||match[2].length>4_000_000||!env.BUCKET)return Response.json({error:'Invalid photo'},{status:400});
        const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
        await env.BUCKET.put(`${user.userId}/${r.id}`,bytes,{httpMetadata:{contentType:'image/'+match[1]}});
        r.data={...r.data,dataUrl:''};
      }
    }
    const statements=body.records.map((r:any)=>recordDB().prepare('INSERT INTO training_records (user_id, record_key, kind, payload, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, record_key) DO UPDATE SET payload=excluded.payload, updated=excluded.updated').bind(user.userId,r.key,r.kind,JSON.stringify(r),new Date().toISOString()));
    await recordDB().batch(statements);
    return Response.json({saved:statements.length});
  }catch(e){console.error('History write failed',e);return Response.json({error:'Cloud save unavailable. Keep the local copy and retry.'},{status:503})}
}
