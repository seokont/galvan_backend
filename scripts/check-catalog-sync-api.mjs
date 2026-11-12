import 'reflect-metadata';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {NestFactory} from '@nestjs/core';
import {Pool} from 'pg';
if(existsSync('.env'))loadEnvFile('.env');
const {AppModule}=await import('../dist/app.module.js');
const {sessionHash}=await import('../dist/admin/password.js');
const app=await NestFactory.create(AppModule,{logger:false});
const db=app.get(Pool),id=randomUUID(),token=randomBytes(32).toString('base64url');
try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const call=(method='GET',auth=false)=>fetch(base+'/admin/catalog-sync',{method,headers:auth?{authorization:'Bearer '+token}:{}});
  assert.equal((await call()).status,401);assert.equal((await call('POST')).status,401);
  const admin=(await db.query('SELECT id FROM atelier_catalog.admin_accounts LIMIT 1')).rows[0];assert.ok(admin);
  await db.query("INSERT INTO atelier_catalog.admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",[sessionHash(token),admin.id]);
  assert.equal((await db.query("SELECT 1 FROM atelier_catalog.catalog_sync_runs WHERE status='running'")).rowCount,0,'Active import exists: abort safely');
  await db.query("INSERT INTO atelier_catalog.catalog_sync_runs(id,status,started_by) VALUES($1,'running',$2)",[id,admin.id]);
  const initial=await call('GET',true);assert.equal(initial.status,200);assert.match(initial.headers.get('cache-control'),/no-store/);
  const state=await initial.json();assert.equal(state.job.id,id);
  if(process.env.ODOO_API_KEY)assert.ok(!JSON.stringify(state).includes(process.env.ODOO_API_KEY));
  if(state.enabled){const responses=await Promise.all([call('POST',true),call('POST',true)]);for(const response of responses){assert.equal(response.status,201);assert.equal((await response.json()).job.id,id);}}
  await db.query("UPDATE atelier_catalog.catalog_sync_runs SET heartbeat_at=now()-interval '3 minutes' WHERE id=$1",[id]);
  assert.equal((await (await call('GET',true)).json()).job.status,'failed');
  await db.query("UPDATE atelier_catalog.catalog_sync_runs SET status='running',heartbeat_at=now(),finished_at=NULL WHERE id=$1",[id]);
  const worker=spawnSync(process.execPath,['scripts/catalog-sync-worker.mjs',id],{env:{...process.env,ODOO_API_KEY:''},encoding:'utf8',timeout:15000});
  assert.equal(worker.status,1);const failed=(await db.query('SELECT status,error FROM atelier_catalog.catalog_sync_runs WHERE id=$1',[id])).rows[0];assert.equal(failed.status,'failed');assert.ok(failed.error);
  console.log('Sync job API OK: admin auth, private state, duplicate start reuse, stale-job recovery and worker failure reporting without Odoo access.');
}finally{
  await db.query('DELETE FROM atelier_catalog.catalog_sync_runs WHERE id=$1',[id]);
  await db.query('DELETE FROM atelier_catalog.admin_sessions WHERE token_hash=$1',[sessionHash(token)]);
  await app.close();
}
