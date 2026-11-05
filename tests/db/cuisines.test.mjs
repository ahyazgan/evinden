import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, failure } from './harness.mjs';

const OWNER = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000a2';
const SELLER = '10000000-0000-0000-0000-000000000001';

let db;
before(async () => {
  db = await createDb();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${OWNER}'),('${OTHER}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${OWNER}','Satıcı','seller',true),('${OTHER}','Başka','seller',true);
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active) VALUES ('${SELLER}','${OWNER}','Lokanta','restaurant',true);
  `);
});

const read = async () => (await db.query(`SELECT cuisines FROM public.sellers WHERE id='${SELLER}'`)).rows[0].cuisines;

describe('Restoran mutfakları', () => {
  test('varsayılan boş, satıcı kendi mutfağını seçer', async () => {
    assert.deepEqual(await read(), []);
    await as(db, OWNER, `UPDATE public.sellers SET cuisines='{doner,pide}' WHERE id='${SELLER}'`);
    assert.deepEqual(await read(), ['doner', 'pide']);
  });
  test('listede olmayan mutfak reddedilir', async () => {
    const f = await failure(db, OWNER, `UPDATE public.sellers SET cuisines='{uydurma}' WHERE id='${SELLER}'`);
    assert.equal(f?.code, '23514');
  });
  test('üçten fazla seçilemez', async () => {
    const f = await failure(db, OWNER, `UPDATE public.sellers SET cuisines='{doner,pide,pizza,burger}' WHERE id='${SELLER}'`);
    assert.equal(f?.code, '23514');
  });
  test('başka satıcı değiştiremez', async () => {
    await as(db, OTHER, `UPDATE public.sellers SET cuisines='{pizza}' WHERE id='${SELLER}'`).catch(() => undefined);
    assert.deepEqual(await read(), ['doner', 'pide']);
  });
});
