// Isolated browser fixture: synthetic records, in-memory SQL, loopback only.
// Never used in a deployed application. Run with node scripts/local-fixture.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const db = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select '${uid}'::uuid$$;
create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
grant usage on schema auth,public to authenticated;grant execute on all functions in schema auth to authenticated;`);
await db.exec(await readFile('scripts/schema.template','utf8')+'\ncommit;');
await db.exec(await readFile('migrations/030_clientes_y_hoja.sql','utf8'));
await db.exec(await readFile('migrations/031_estabilidad_facturas.sql','utf8'));
await db.exec(await readFile('migrations/032_presupuestos.sql','utf8'));
await db.exec(await readFile('migrations/033_calendario.sql','utf8'));
await db.exec(`insert into auth.users values('${uid}','admin@roboticlab.internal',now());
insert into rl_members values('admin@roboticlab.internal','admin');
insert into rl_settings(id,company) values(1,'{"name":"Academia de pruebas","brand":"Demo","tax_id":"12345678Z","address":"Dirección ficticia","email":"admin@example.test","payment_terms":"Transferencia","exemption":"Actividad exenta"}');
insert into rl_clients(id,name,tax_id) values('${client}','Cliente de prueba','12345678Z');
set role authenticated;`);
let failures = false;
const user = {id:uid,aud:'authenticated',role:'authenticated',email:'admin@roboticlab.internal',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const numbers = (v) => v instanceof Date ? v.toISOString().slice(0,10) : Array.isArray(v) ? v.map(numbers) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(subtotal|vat|withholding|withholding_rate|total|amount|price|rate|units|month_hours|pack_units|paid|advance|expected)$/.test(k)&&x!==null?Number(x):numbers(x)])) : v;
const server=createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3101');
  res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
  const u=new URL(req.url,'http://127.0.0.1:4545');
  function reply(body,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(numbers(body)));}
  if(req.method==='OPTIONS') return reply({});
  if(u.pathname==='/fixture') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(`<h1>Pruebas aisladas de Gestión RL</h1><p>Errores de lectura: ${failures?'ACTIVOS':'desactivados'}</p><form method="post" action="/fixture/toggle"><button>Alternar fallo de conexión</button></form><a href="http://127.0.0.1:3101">Volver a la aplicación de pruebas</a>`);}
  if(u.pathname==='/fixture/toggle'&&req.method==='POST'){failures=!failures;res.writeHead(303,{Location:'/fixture'});return res.end();}
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  let body={};try {body=JSON.parse(Buffer.concat(chunks).toString()||'{}');} catch {return reply({message:'Invalid JSON'},400);}
  if(u.pathname==='/auth/v1/token') return reply({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user});
  if(u.pathname==='/auth/v1/user') return reply(user);
  if(u.pathname==='/auth/v1/logout') return reply({});
  try {
    if(u.pathname.startsWith('/rest/v1/rpc/')) {
      const name=u.pathname.split('/').at(-1);
      if(!/^rl_[a-z_]+$/.test(name)||Object.keys(body).some(k=>!/^\w+$/.test(k))) throw Error('Invalid RPC');
      const result=await db.query(`select ${name}(${Object.keys(body).map((k,i)=>`${k} => $${i+1}`).join(',')}) result`,Object.values(body).map(x=>typeof x==='object'?JSON.stringify(x):x));
      return reply(result.rows[0].result);
    }
    const table=u.pathname.split('/').at(-1);
    if(!/^rl_[a-z_]+$/.test(table)) return reply({message:'Not found'},404);
    if(failures&&req.method==='GET') return setTimeout(()=>reply({message:'Fallo de lectura simulado'},503),2500);
    const args=[],conditions=[];
    for(const[k,v]of u.searchParams) if(v.startsWith('eq.')&&/^[a-z_]+$/.test(k)){args.push(v.slice(3));conditions.push(`${k}=$${args.length}`);}
    if(req.method==='POST'){
      const keys=Object.keys(body);if(keys.some(k=>!/^\w+$/.test(k))) throw Error('Invalid fields');
      await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(body));return reply(null,201);
    }
    const selection=u.searchParams.get('select')||'*';if(!/^[a-z_0-9,*]+$/.test(selection)) throw Error('Invalid selection');
    let q=`select ${selection} from ${table}${conditions.length?' where '+conditions.join(' and '):''}`;
    const order=u.searchParams.get('order');if(order){const[k,d]=order.split('.');if(!/^\w+$/.test(k))throw Error('Invalid order');q+=` order by ${k} ${d==='desc'?'desc':'asc'}`;}
    if(u.searchParams.has('limit'))q+=' limit '+Number(u.searchParams.get('limit'));
    if(u.searchParams.has('offset'))q+=' offset '+Number(u.searchParams.get('offset'));
    const result=await db.query(q,args);
    reply(req.headers.accept?.includes('vnd.pgrst.object')?result.rows[0]:result.rows);
  } catch(e){reply({message:e.message},400);}
});
server.listen(4545,'127.0.0.1',()=>console.log('Fixture SQL: http://127.0.0.1:4545/fixture'));
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3101'],{stdio:'inherit',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4545',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'',VERIFACTU_PFX_BASE64:''}});
function stop(){next.kill();server.close();void db.close();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
