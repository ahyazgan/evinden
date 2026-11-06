// 055: Restoran ödeme sıklığını seçer; günlük seçen restoran her gün, diğerleri haftalık kesilir.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
  admin = await user('admin');
});

async function user(role = 'buyer') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

async function seller() {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Günlük Lokanta',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

async function deliveredAt(s, when) {
  const o = (await as(db, await user(), 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash'])).rows[0];
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${o.id}'`);
  }
  await db.exec(`UPDATE public.orders SET delivered_at='${when}' WHERE id='${o.id}'`);
  return o;
}

async function service(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const payoutOf = async id => (await one('SELECT payout_id FROM public.orders WHERE id=$1', [id])).payout_id;
const setPolicy = patch => db.exec(`UPDATE public.app_config SET value = value || '${JSON.stringify(patch)}'::jsonb WHERE key='payout_policy'`);

describe('Ödeme sıklığı tercihi', () => {
  test('restoran yalnızca kendi tercihini, geçerli değerle değiştirir', async () => {
    const s = await seller();
    assert.equal((await as(db, s.uid, `SELECT public.set_my_payout_frequency('daily') AS f`)).rows[0].f, 'daily');
    assert.equal((await as(db, s.uid, 'SELECT frequency FROM public.seller_payout_preferences')).rows[0].frequency, 'daily');
    assert.equal((await failure(db, s.uid, `SELECT public.set_my_payout_frequency('monthly')`))?.code, '22023');
    // Müşteri tercih yapamaz, başka restoranın tercihini göremez.
    const buyer = await user();
    assert.equal((await failure(db, buyer, `SELECT public.set_my_payout_frequency('daily')`))?.code, '42501');
    assert.equal((await as(db, (await seller()).uid, 'SELECT count(*)::int n FROM public.seller_payout_preferences')).rows[0].n, 0);
    // Tabloya doğrudan yazılamaz.
    assert.equal((await failure(db, s.uid, `UPDATE public.seller_payout_preferences SET frequency='weekly'`))?.code, '42501');
    // Yönetici günlük seçeneği kapatınca seçilemez.
    await setPolicy({ allow_daily: false });
    assert.equal((await failure(db, s.uid, `SELECT public.set_my_payout_frequency('daily')`))?.code, '55000');
    await setPolicy({ allow_daily: true });
    assert.equal((await failure(db, admin, `SELECT public.admin_update_payout_policy('{"allow_daily":"evet"}')`))?.code, '22023');
  });
});

describe('Günlük kesim', () => {
  test('dünün teslimi bugün 06:00 kesilir; günlük restoran haftalık kesime girmez', async () => {
    const daily = await seller();
    await as(db, daily.uid, `SELECT public.set_my_payout_frequency('daily')`);
    const weekly = await seller();
    // 2032-03-04 perşembe 06:00 çalışması. Dün (çarşamba) 23:30'daki teslim dahil dünün tamamı bugün kesilir;
    // bugün 01:00'deki teslim yarına kalır.
    const yesterday = await deliveredAt(daily, '2032-03-03T23:30:00+03:00');
    const today = await deliveredAt(daily, '2032-03-04T01:00:00+03:00');
    const weeklyOrder = await deliveredAt(weekly, '2032-03-03T21:00:00+03:00');

    const r = (await service(`SELECT public.generate_daily_settlements('2032-03-04T06:00:00+03:00') AS r`)).rows[0].r;
    assert.equal(new Date(r.period_end).getTime(), new Date('2032-03-04T00:00:00+03:00').getTime());
    assert.notEqual(await payoutOf(yesterday.id), null);
    assert.equal(await payoutOf(today.id), null);
    assert.equal(await payoutOf(weeklyOrder.id), null, 'haftalık restoran günlük kesime girmez');

    const payout = await one('SELECT * FROM public.seller_payouts WHERE seller_id=$1', [daily.id]);
    assert.equal(payout.kind, 'daily');
    assert.equal(new Date(payout.period_end).getTime(), new Date('2032-03-04T00:00:00+03:00').getTime());
    assert.equal(payout.status, 'pending');
    assert.equal((await one(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Günlük hesap kesimin hazır'`, [daily.uid])).n, 1);
    assert.equal((await as(db, admin, 'SELECT * FROM public.admin_pending_payouts()')).rows.find(p => p.id === payout.id).kind, 'daily');
    // Aynı gün ikinci kez kesilmez; ertesi gün bugünkü teslim kesilir.
    assert.equal((await service(`SELECT public.generate_daily_settlements('2032-03-04T09:00:00+03:00') AS r`)).rows[0].r.skipped, true);
    await service(`SELECT public.generate_daily_settlements('2032-03-05T06:00:00+03:00')`);
    assert.notEqual(await payoutOf(today.id), null);
    // İkinci kesimin dönem başı restoranın önceki kesiminin sonudur.
    const second = await one('SELECT * FROM public.seller_payouts WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 1', [daily.id]);
    assert.equal(new Date(second.period_start).getTime(), new Date('2032-03-04T00:00:00+03:00').getTime());

    // Haftalık kesim günlük restorana dokunmaz, haftalığı keser.
    const late = await deliveredAt(daily, '2032-03-05T12:00:00+03:00');
    await service(`SELECT public.generate_weekly_settlements('2032-03-10T06:00:00+03:00')`);
    assert.notEqual(await payoutOf(weeklyOrder.id), null);
    assert.equal(await payoutOf(late.id), null);
    assert.equal((await one(`SELECT kind FROM public.seller_payouts WHERE seller_id=$1`, [weekly.id])).kind, 'weekly');
  });

  test('günlük seçenek kapatılınca günlük restoran haftalık kesilir; görev ikisini de çalıştırır', async () => {
    const s = await seller();
    await as(db, s.uid, `SELECT public.set_my_payout_frequency('daily')`);
    const o = await deliveredAt(s, '2032-04-01T12:00:00+03:00');
    await setPolicy({ allow_daily: false });
    assert.equal((await service(`SELECT public.generate_daily_settlements('2032-04-03T06:00:00+03:00') AS r`)).rows[0].r.reason, 'daily_disabled');
    assert.equal(await payoutOf(o.id), null);
    await service(`SELECT public.generate_weekly_settlements('2032-04-06T06:00:00+03:00')`);
    assert.equal((await one('SELECT p.kind FROM public.orders o JOIN public.seller_payouts p ON p.id = o.payout_id WHERE o.id=$1', [o.id])).kind, 'weekly');
    await setPolicy({ allow_daily: true });

    const r = (await service('SELECT public.run_weekly_settlements() AS r')).rows[0].r;
    assert.ok(r.weekly && r.daily);
    assert.ok(!r.weekly.error && !r.daily.error);
    const manual = (await as(db, admin, 'SELECT public.admin_run_weekly_settlement() AS r')).rows[0].r;
    assert.equal(typeof manual.skipped, 'boolean');
    assert.equal((await failure(db, s.uid, 'SELECT public.admin_run_weekly_settlement()'))?.code, '42501');
  });
});
