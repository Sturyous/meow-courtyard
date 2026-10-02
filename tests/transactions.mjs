import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec("insert into players(id,room,name,appearance,last_snapshot,flowers) values('legacy','qa','legacy','{}','{\"headFlower\":\"rose\"}','{\"rose\":2}')");
  const migration = await readFile(new URL('../supabase/transactions.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  assert.equal((await db.query("select head_flower from players where id='legacy'")).rows[0].head_flower,'rose');
  for (const id of ['A','B']) await db.query("insert into players(id,room,name,appearance,last_snapshot,flowers) values($1,'qa',$1,'{}','{}','{\"rose\":3,\"tulip\":2}')",[id]);
  const act = async (who, action, args = {}, request = randomUUID()) => (await db.query('select flower_action($1,$2,$3,$4,$5) as result',['qa',who,request,action,args])).rows[0].result;
  let r=await act('A','equip',{flower:'rose'});
  assert.equal(r.flowers.rose,2); assert.equal(r.headFlower,'rose');
  r=await act('A','equip',{flower:'tulip'});
  assert.equal(r.flowers.rose,3); assert.equal(r.flowers.tulip,1);
  r=await act('A','equip',{flower:null}); assert.equal(r.flowers.tulip,2);
  await db.exec(migration); // Re-applying migration must not resurrect an old flower.
  assert.equal((await db.query("select head_flower from players where id='A'")).rows[0].head_flower,null);
  const req=randomUUID();
  const placed=await act('A','place-decor',{flower:'rose',scene:'yard',x:200,y:300},req);
  assert.deepEqual(await act('A','place-decor',{},req),placed,'retry returns receipt without taking another flower');
  await act('B','recover-decor',{id:placed.decor.id});
  await assert.rejects(act('A','recover-decor',{id:placed.decor.id}),/ALREADY_CLAIMED/);
  assert.equal((await db.query("select flowers->>'rose' as roses from players where id='A'")).rows[0].roses,'2');
  const note=await act('A','place-note',{flower:'tulip',scene:'cabin',x:500,y:400,kind:'note',text:'一起待着'});
  await act('B','open-note',{id:note.note.id});
  await assert.rejects(act('A','open-note',{id:note.note.id}),/ALREADY_CLAIMED/);
  await assert.rejects(act('A','place-decor',{flower:'sunflower',scene:'yard',x:200,y:300}),/NO_FLOWER/);
  assert.equal((await db.query('select count(*)::int as count from decor')).rows[0].count,0,'failed debit rolls back creation');
  await act('A','plant',{plot:0,flower:'rose'});
  await Promise.all([act('A','water',{plot:0}),act('B','water',{plot:0})]);
  let crop=(await db.query("select * from garden_plots where plot=0")).rows[0];
  assert.equal(crop.stage,0); assert.equal(crop.watered_by.length,2);
  await db.exec("update garden_plots set stage_at=now()-interval '19 hours',last_watered_at=now()-interval '96 hours'");
  crop=(await db.query("select * from read_garden('qa')")).rows[0];
  assert.equal(crop.stage,1); assert.deepEqual(crop.watered_by,[]);
  await act('A','water',{plot:0}); await act('A','water',{plot:0});
  crop=(await db.query("select * from garden_plots where plot=0")).rows[0];
  assert.deepEqual(crop.watered_by,['A']);
  await db.exec("update garden_plots set stage=4");
  r=await act('A','harvest',{plot:0}); assert.equal(r.flowers.rose,3);
  await assert.rejects(act('B','harvest',{plot:0}),/NOT_READY/);
  console.log('PASS: inventory conservation, receipts, stale claims, rollback, early watering, revival and harvest');
} finally { await db.close(); }
