// 060: Ürün değiştirme teklifi, kurumsal hesap (üyelik, bütçe), çift sipariş koruması ve POS bağlantısı.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
});

async function user(role = 'buyer', name = 'Test') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','${name}','${role}',true);
  `);
  return id;
}

async function admin() { return user('admin', 'Yönetici'); }

async function seller() {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  const twin = randomUUID();
  const pricey = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active, delivery_time_min, delivery_time_max)
      VALUES ('${id}','${uid}','Köşe Lokanta',true,20,45);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES
      ('${item}','${id}','Kola',5000), ('${twin}','${id}','Ayran',5000), ('${pricey}','${id}','Şalgam',6000);
  `);
  return { uid, id, item, twin, pricey };
}

const lines = (s, qty = 1) => JSON.stringify([{ menu_item_id: s.item, quantity: qty }]);

async function idem(buyer, s, key, ws = null, qty = 1) {
  return (await as(db, buyer,
    `SELECT * FROM public.place_order_idempotent($1, $2, $3::jsonb, 'Test Mah. No:1', p_payment_method => 'cash', p_corporate_workspace => $4)`,
    [key, s.id, lines(s, qty), ws])).rows[0];
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

describe('Çift sipariş koruması', () => {
  test('aynı anahtar ikinci sipariş açmaz, ilkini döndürür', async () => {
    const s = await seller();
    const buyer = await user();
    const key = randomUUID();
    const a = await idem(buyer, s, key);
    const b = await idem(buyer, s, key);
    assert.equal(a.id, b.id);
    assert.equal((await one('SELECT count(*)::int n FROM public.orders WHERE customer_id=$1', [buyer])).n, 1);
    const c = await idem(buyer, s, randomUUID());
    assert.notEqual(c.id, a.id);
  });

  test('başka müşterinin anahtarı onun siparişini göstermez', async () => {
    const s = await seller();
    const key = randomUUID();
    const a = await idem(await user(), s, key);
    const other = await user();
    const b = await idem(other, s, key);
    assert.notEqual(a.id, b.id);
    assert.equal(b.customer_id, other);
  });

  test('anahtarsız çağrı reddedilir, eski imza kalmadı', async () => {
    const s = await seller();
    assert.equal((await failure(db, await user(), `SELECT public.place_order_idempotent(NULL, $1, $2::jsonb, 'Adres')`, [s.id, lines(s)]))?.code, '22023');
    const n = (await one(`SELECT count(*)::int n FROM pg_proc WHERE proname='place_order_idempotent'`)).n;
    assert.equal(n, 1);
  });
});

describe('Ürün değiştirme teklifi', () => {
  async function acceptedOrder() {
    const s = await seller();
    const buyer = await user();
    const o = await idem(buyer, s, randomUUID());
    await as(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]);
    const item = await one('SELECT * FROM public.order_items WHERE order_id=$1', [o.id]);
    return { s, buyer, o, item };
  }

  test('aynı fiyatlı ürün önerilir, müşteri kabul edince kalem değişir ve restorana bildirilir', async () => {
    const { s, buyer, o, item } = await acceptedOrder();
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Kola bitti')`, [item.id, s.twin])).rows[0];
    assert.equal(sub.replacement_title, 'Ayran');
    const note = await one(`SELECT body, data FROM public.notifications WHERE user_id=$1 AND title='Ürün değişikliği önerisi'`, [buyer]);
    assert.match(note.body, /Kola yerine Ayran olur mu\? Kola bitti/);
    assert.equal(note.data.substitutionId, sub.id);
    // Müşteri teklifi görebilir.
    assert.equal((await as(db, buyer, 'SELECT count(*)::int n FROM public.order_item_substitutions WHERE order_id=$1', [o.id])).rows[0].n, 1);
    await as(db, buyer, 'SELECT public.respond_item_substitution($1, true)', [sub.id]);
    const after = await one('SELECT * FROM public.order_items WHERE id=$1', [item.id]);
    assert.equal(after.title_snapshot, 'Ayran');
    assert.equal(after.menu_item_id, s.twin);
    assert.ok(await one(`SELECT 1 FROM public.notifications WHERE user_id=$1 AND title='Ürün değişikliği onaylandı'`, [s.uid]));
  });

  test('red restorana nedeniyle bildirilir, kalem değişmez', async () => {
    const { s, buyer, item } = await acceptedOrder();
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Kola bitti')`, [item.id, s.twin])).rows[0];
    await as(db, buyer, `SELECT public.respond_item_substitution($1, false, 'Ayran sevmem')`, [sub.id]);
    assert.equal((await one('SELECT title_snapshot FROM public.order_items WHERE id=$1', [item.id])).title_snapshot, 'Kola');
    const n = await one(`SELECT body FROM public.notifications WHERE user_id=$1 AND title='Ürün değişikliği reddedildi'`, [s.uid]);
    assert.match(n.body, /Not: Ayran sevmem/);
  });

  test('farklı fiyat, menü dışı ürün, aynı ürün, bekleyen teklif ve 3 sınırı reddedilir', async () => {
    const { s, buyer, item, o } = await acceptedOrder();
    const propose = (target, uid = s.uid) => failure(db, uid, `SELECT public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, target]);
    assert.equal((await propose(s.pricey))?.code, '22023');
    assert.equal((await propose(s.item))?.code, '22023');
    assert.equal((await propose((await seller()).twin))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.propose_item_substitution($1,NULL,'Serbest metin','Bitti')`, [item.id]))?.code, '22023');
    // Başka restoran başkasının siparişine teklif yazamaz, müşteri de yazamaz.
    assert.equal((await propose(s.twin, (await seller()).uid))?.code, '42501');
    assert.equal((await propose(s.twin, buyer))?.code, '42501');

    const first = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin])).rows[0];
    assert.equal((await propose(s.twin))?.code, '55000', 'yanıt bekleyen teklif varken ikincisi olmaz');
    // Süresi dolan teklif yenisine engel olmaz; üçüncüden sonra durur.
    await db.query(`UPDATE public.order_item_substitutions SET expires_at = now() - interval '1 minute' WHERE id=$1`, [first.id]);
    const second = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin])).rows[0];
    assert.equal((await one('SELECT status FROM public.order_item_substitutions WHERE id=$1', [first.id])).status, 'expired');
    await as(db, buyer, 'SELECT public.respond_item_substitution($1, false)', [second.id]);
    await as(db, s.uid, `SELECT public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin]);
    assert.equal((await one('SELECT count(*)::int n FROM public.order_item_substitutions WHERE order_item_id=$1', [item.id])).n, 3);
    await db.query(`UPDATE public.order_item_substitutions SET status='rejected' WHERE order_item_id=$1 AND status='pending'`, [item.id]);
    assert.equal((await propose(s.twin))?.code, '55000');
    assert.ok(o);
  });

  test('kabulde günlük adet yeni üründen düşer, eskiye iade edilir; tükenmiş ürün kabul edilemez', async () => {
    const { s, buyer, item } = await acceptedOrder();
    await db.query(`UPDATE public.menu_items SET daily_limit = 10 WHERE id = ANY($1)`, [[s.item, s.twin]]);
    await db.query(`UPDATE public.menu_items SET sold_today = 4, stock_reset_date = (now() AT TIME ZONE 'Europe/Istanbul')::date WHERE id = $1`, [s.item]);
    await db.query(`UPDATE public.menu_items SET sold_today = 2, stock_reset_date = (now() AT TIME ZONE 'Europe/Istanbul')::date WHERE id = $1`, [s.twin]);
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin])).rows[0];
    await as(db, buyer, 'SELECT public.respond_item_substitution($1, true)', [sub.id]);
    assert.equal((await one('SELECT sold_today FROM public.menu_items WHERE id=$1', [s.item])).sold_today, 3);
    assert.equal((await one('SELECT sold_today FROM public.menu_items WHERE id=$1', [s.twin])).sold_today, 3);

    const second = await acceptedOrder();
    await db.query(`UPDATE public.menu_items SET daily_limit = 1, sold_today = 0, stock_reset_date = NULL WHERE id = $1`, [second.s.twin]);
    const sub2 = (await as(db, second.s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [second.item.id, second.s.twin])).rows[0];
    await db.query(`UPDATE public.menu_items SET sold_today = 1, stock_reset_date = (now() AT TIME ZONE 'Europe/Istanbul')::date WHERE id = $1`, [second.s.twin]);
    const r = (await as(db, second.buyer, 'SELECT (public.respond_item_substitution($1, true)).status AS status', [sub2.id])).rows[0];
    assert.equal(r.status, 'expired');
    assert.equal((await one('SELECT title_snapshot FROM public.order_items WHERE id=$1', [second.item.id])).title_snapshot, 'Kola');
    assert.ok(await one(`SELECT 1 FROM public.notifications WHERE user_id=$1 AND title='Ürün değişikliği geçersiz'`, [second.s.uid]));
  });

  test('seçimli kalemde ve zorunlu seçimli ürüne öneri yapılamaz', async () => {
    const { s, item } = await acceptedOrder();
    await db.query(`INSERT INTO public.menu_option_groups (menu_item_id, title, min_select) VALUES ($1, 'Sos', 1)`, [s.twin]);
    assert.equal((await failure(db, s.uid, `SELECT public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin]))?.code, '22023');
    const other = await acceptedOrder();
    await db.query(`UPDATE public.order_items SET title_snapshot = 'Kola (Büyük)' WHERE id = $1`, [other.item.id]);
    const err = await failure(db, other.s.uid, `SELECT public.propose_item_substitution($1,$2,NULL,'Bitti')`, [other.item.id, other.s.twin]);
    assert.match(err?.message ?? '', /Seçimli/);
  });

  test('bekleyen siparişte öneri yapılamaz; süresi dolan teklife yanıt kalemi değiştirmez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await idem(buyer, s, randomUUID());
    const item = await one('SELECT * FROM public.order_items WHERE order_id=$1', [o.id]);
    assert.equal((await failure(db, s.uid, `SELECT public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin]))?.code, '22023');
    await as(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]);
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin])).rows[0];
    await db.query(`UPDATE public.order_item_substitutions SET expires_at = now() - interval '1 minute' WHERE id=$1`, [sub.id]);
    const r = (await as(db, buyer, 'SELECT (public.respond_item_substitution($1, true)).status AS status', [sub.id])).rows[0];
    assert.equal(r.status, 'expired');
    assert.equal((await one('SELECT title_snapshot FROM public.order_items WHERE id=$1', [item.id])).title_snapshot, 'Kola');
  });
});

describe('Kurumsal hesap', () => {
  async function workspace(budgetCents = 20000) {
    const owner = await user('buyer', 'Ayşe');
    const adm = await admin();
    const ws = (await as(db, owner, 'SELECT * FROM public.request_corporate_workspace($1, $2)', ['Acme Ltd', budgetCents])).rows[0];
    await as(db, adm, 'SELECT public.admin_approve_corporate_workspace($1, true)', [ws.id]);
    const me = (await as(db, owner, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r;
    return { owner, adm, ws, code: me.join_code };
  }

  test('onayda kod üretilir, sahip üye olur, çalışan kodla katılır ve sahibine bildirilir', async () => {
    const { owner, ws, code } = await workspace();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    const me = (await as(db, owner, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r;
    assert.equal(me.role, 'owner');
    assert.equal(me.status, 'active');
    const worker = await user('buyer', 'Mehmet');
    const r = (await as(db, worker, 'SELECT public.join_corporate_workspace($1) AS r', [code.toLowerCase().slice(0, 4) + '-' + code.slice(4)])).rows[0].r;
    assert.equal(r.ok, true);
    const wm = (await as(db, worker, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r;
    assert.equal(wm.role, 'member');
    assert.equal(wm.join_code, null, 'kod yalnızca sahibe görünür');
    assert.ok(await one(`SELECT 1 FROM public.notifications WHERE user_id=$1 AND body LIKE 'Mehmet Acme Ltd%'`, [owner]));
    // Üye başka bir şirkete katılamaz, şirket talebi de açamaz.
    const other = await workspace();
    assert.equal((await failure(db, worker, 'SELECT public.join_corporate_workspace($1)', [other.code]))?.code, '55000');
    assert.equal((await failure(db, worker, `SELECT public.request_corporate_workspace('Yan Şirket')`))?.code, '55000');
    assert.ok(ws);
  });

  test('yanlış kod sayılır, 10 denemeden sonra durur; onaysız hesaba kodla girilmez', async () => {
    const worker = await user();
    for (let i = 0; i < 10; i++) {
      const r = (await as(db, worker, `SELECT public.join_corporate_workspace('ZZZZZZZZ') AS r`)).rows[0].r;
      assert.equal(r.ok, false);
    }
    assert.equal((await failure(db, worker, `SELECT public.join_corporate_workspace('ZZZZZZZZ')`))?.code, '55000');
    const owner = await user();
    const ws = (await as(db, owner, `SELECT * FROM public.request_corporate_workspace('Bekleyen AŞ')`)).rows[0];
    assert.equal(ws.join_code, null);
  });

  test('şirket siparişi bütçeden düşer, bütçeyi aşan sipariş açılmaz, iptal bütçeyi geri verir', async () => {
    const { owner, ws, code } = await workspace(12000);
    const s = await seller();
    const worker = await user('buyer', 'Can');
    await as(db, worker, 'SELECT public.join_corporate_workspace($1)', [code]);
    const o = await idem(worker, s, randomUUID(), ws.id); // 50 TL + teslimat
    assert.equal(o.corporate_workspace_id, ws.id);
    const spent = (await as(db, worker, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r.month_spent_cents;
    assert.equal(spent, o.total_cents);
    const before = (await one('SELECT count(*)::int n FROM public.orders WHERE customer_id=$1', [worker])).n;
    const err = await failure(db, worker,
      `SELECT public.place_order_idempotent($1, $2, $3::jsonb, 'Adres', p_corporate_workspace => $4)`,
      [randomUUID(), s.id, lines(s, 2), ws.id]);
    assert.equal(err?.code, 'EVN06');
    assert.equal((await one('SELECT count(*)::int n FROM public.orders WHERE customer_id=$1', [worker])).n, before, 'sipariş geri alındı');
    // Kişisel sipariş bütçeye bakmaz.
    const personal = await idem(worker, s, randomUUID(), null, 2);
    assert.equal(personal.corporate_workspace_id, null);
    // İptal edilen şirket siparişi harcamadan düşer.
    await as(db, worker, `SELECT public.cancel_order($1)`, [o.id]).catch(async () => {
      await db.query(`UPDATE public.orders SET status='cancelled' WHERE id=$1`, [o.id]);
    });
    const report = (await as(db, owner, 'SELECT public.corporate_workspace_report() AS r')).rows[0].r;
    assert.equal(report.spent_cents, 0);
    assert.equal(report.members.length, 2);
    assert.equal(report.orders.length, 1);
    assert.equal(report.orders[0].member_name, 'Can');
    assert.equal(report.orders[0].restaurant_name, 'Köşe Lokanta');
    assert.equal(report.orders[0].delivery_address, undefined, 'adres rapora girmez');
  });

  test('üye olmayan, çıkarılan ve askıdaki şirketle sipariş verilemez; alan elle yazılamaz', async () => {
    const { owner, adm, ws, code } = await workspace(null);
    const s = await seller();
    const outsider = await user();
    assert.equal((await failure(db, outsider, `SELECT public.place_order_idempotent($1,$2,$3::jsonb,'Adres',p_corporate_workspace=>$4)`, [randomUUID(), s.id, lines(s), ws.id]))?.code, '42501');
    const worker = await user();
    await as(db, worker, 'SELECT public.join_corporate_workspace($1)', [code]);
    const personal = await idem(worker, s, randomUUID());
    await as(db, worker, 'UPDATE public.orders SET corporate_workspace_id=$1 WHERE id=$2', [ws.id, personal.id]).catch(() => {});
    assert.equal((await one('SELECT corporate_workspace_id FROM public.orders WHERE id=$1', [personal.id])).corporate_workspace_id, null);

    await as(db, owner, 'SELECT public.corporate_remove_member($1)', [worker]);
    assert.equal((await failure(db, worker, `SELECT public.place_order_idempotent($1,$2,$3::jsonb,'Adres',p_corporate_workspace=>$4)`, [randomUUID(), s.id, lines(s), ws.id]))?.code, '42501');
    // Sahip kendini çıkaramaz, ayrılamaz; üye olmayan sahip işlemi yapamaz.
    assert.equal((await failure(db, owner, 'SELECT public.corporate_remove_member($1)', [owner]))?.code, '55000');
    assert.equal((await failure(db, owner, 'SELECT public.leave_corporate_workspace()'))?.code, '55000');
    assert.equal((await failure(db, worker, 'SELECT public.corporate_regenerate_code()'))?.code, '42501');

    await as(db, adm, 'SELECT public.admin_approve_corporate_workspace($1, false)', [ws.id]);
    assert.equal((await failure(db, owner, `SELECT public.place_order_idempotent($1,$2,$3::jsonb,'Adres',p_corporate_workspace=>$4)`, [randomUUID(), s.id, lines(s), ws.id]))?.code, '42501');
    // Askıdaki hesabın sahibi ayrılıp yeni talep açabilir.
    await as(db, owner, 'SELECT public.leave_corporate_workspace()');
    await as(db, owner, `SELECT public.request_corporate_workspace('Yeni Ltd')`);
    const list = (await as(db, adm, 'SELECT * FROM public.admin_corporate_workspaces()')).rows;
    assert.ok(list.some(r => r.id === ws.id && r.status === 'suspended'));
    assert.equal((await failure(db, owner, 'SELECT * FROM public.admin_corporate_workspaces()'))?.code, '42501');
  });

  test('kod yenilenince eski kod çalışmaz; bütçe sınırları denetlenir; üye ayrılabilir', async () => {
    const { owner, code } = await workspace();
    const fresh = (await as(db, owner, 'SELECT public.corporate_regenerate_code() AS c')).rows[0].c;
    assert.notEqual(fresh, code);
    const worker = await user();
    assert.equal((await as(db, worker, 'SELECT public.join_corporate_workspace($1) AS r', [code])).rows[0].r.ok, false);
    assert.equal((await as(db, worker, 'SELECT public.join_corporate_workspace($1) AS r', [fresh])).rows[0].r.ok, true);
    await as(db, worker, 'SELECT public.leave_corporate_workspace()');
    assert.equal((await as(db, worker, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r, null);
    assert.equal((await failure(db, owner, 'SELECT public.corporate_update_budget(-1)'))?.code, '22023');
    await as(db, owner, 'SELECT public.corporate_update_budget(NULL)');
    assert.equal((await as(db, owner, 'SELECT public.my_corporate_workspace() AS r')).rows[0].r.monthly_budget_cents, null);
  });

  test('yeni tablolar istemciye kapalı', async () => {
    const u = await user();
    assert.ok(await failure(db, u, `INSERT INTO public.corporate_workspace_members (workspace_id, user_id) VALUES ($1, $2)`, [randomUUID(), u]));
    assert.ok(await failure(db, u, 'SELECT * FROM public.corporate_join_attempts'));
  });
});

describe('POS bağlantısı', () => {
  test('imza HMAC-SHA256 ile aynı', async () => {
    for (const [k, m] of [['whsec_abc', '1700000000.{"a":1}'], ['x'.repeat(100), 'ğüşİç']]) {
      const sql = (await one('SELECT public._hmac_sha256_hex($1, $2) AS h', [k, m])).h;
      assert.equal(sql, createHmac('sha256', k).update(m, 'utf8').digest('hex'));
    }
  });

  test('adres denetimi: yalnızca dış HTTPS alan adı', async () => {
    const ok = async (u) => (await one('SELECT public._pos_webhook_url_ok($1) AS ok', [u])).ok;
    assert.equal(await ok('https://pos.ornek.com/afiyetli/hook?x=1'), true);
    for (const bad of ['http://pos.ornek.com', 'https://127.0.0.1/x', 'https://localhost/x', 'https://pos.ornek.com:8443/x',
      'https://user@pos.ornek.com', 'https://[::1]/', 'https://metadata.internal/', 'https://abc.supabase.co/rest', 'https://ornek', 'ftp://a.com']) {
      assert.equal(await ok(bad), false, bad);
    }
  });

  test('kayıtta anahtar bir kez verilir, sır istemciye açılmaz, sipariş bildirimi kalemlerle kaydedilir', async () => {
    const s = await seller();
    const saved = (await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', true) AS r`)).rows[0].r;
    assert.match(saved.api_key, /^afy_[0-9a-f]{64}$/);
    assert.match(saved.signing_secret, /^whsec_[0-9a-f]{64}$/);
    const again = (await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook2', true) AS r`)).rows[0].r;
    assert.equal(again.api_key, null, 'güncellemede anahtar yeniden gösterilmez');
    assert.equal(again.integration.config.webhook_url, 'https://pos.ornek.com/hook2');
    assert.ok(await failure(db, s.uid, 'SELECT * FROM public.seller_integration_secrets'));
    assert.ok(await failure(db, s.uid, 'SELECT * FROM public.pos_webhook_deliveries'));
    // Restoran kendi bağlantısını görür.
    assert.equal((await as(db, s.uid, `SELECT count(*)::int n FROM public.seller_integrations WHERE seller_id=$1`, [s.id])).rows[0].n, 1);

    const buyer = await user();
    const o = await idem(buyer, s, randomUUID());
    await as(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]);
    const log = (await as(db, s.uid, 'SELECT * FROM public.pos_delivery_log()')).rows;
    assert.deepEqual(log.map(r => r.event), ['order.status_changed', 'order.created']);
    assert.ok(log.every(r => r.order_id === o.id));
    const payload = (await one('SELECT public._pos_order_payload(o) AS p FROM public.orders o WHERE id=$1', [o.id])).p;
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].title, 'Kola');
    assert.equal(payload.items[0].menu_item_id, s.item);
  });

  test('kapalı bağlantıya ve ödemesi beklenen siparişe bildirim gitmez; adres hatası reddedilir', async () => {
    const s = await seller();
    assert.equal((await failure(db, s.uid, `SELECT public.save_pos_integration('http://pos.ornek.com', true)`))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.save_pos_integration(NULL, true)`))?.code, '22023');
    await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', false)`);
    await idem(await user(), s, randomUUID());
    assert.equal((await as(db, s.uid, 'SELECT count(*)::int n FROM public.pos_delivery_log()')).rows[0].n, 0);
    assert.equal((await failure(db, await user(), `SELECT public.save_pos_integration('https://a.com', true)`))?.code, '42501');
  });

  test('POS anahtarıyla menü okunur ve ürün bitti yapılır; başka restoranın ürünü değişmez; yenilenen anahtar eskisini iptal eder', async () => {
    const s = await seller();
    const other = await seller();
    const { api_key: key } = (await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', true) AS r`)).rows[0].r;
    const menu = (await as(db, null, 'SELECT * FROM public.pos_menu($1)', [key])).rows;
    assert.equal(menu.length, 3);
    // Anonim rol de çağırabilir.
    await db.exec(`SET ROLE anon`);
    const r = (await db.query('SELECT public.pos_set_availability($1, $2::jsonb) AS r', [key, JSON.stringify([
      { id: s.item, available: false }, { id: s.twin, daily_limit: 3 }, { id: other.item, available: false }, { id: 'yanlis' },
    ])])).rows[0].r;
    await db.exec('RESET ROLE');
    assert.deepEqual(r, { updated: 2, unknown: 2 });
    // Bozuk satır ve çok büyük sayı tüm isteği düşürmez.
    const r2 = (await as(db, null, 'SELECT public.pos_set_availability($1, $2::jsonb) AS r', [key, JSON.stringify(['daily_limit', 5, { id: s.pricey, daily_limit: 1e12 }])])).rows[0].r;
    assert.deepEqual(r2, { updated: 1, unknown: 2 });
    assert.equal((await one('SELECT daily_limit FROM public.menu_items WHERE id=$1', [s.pricey])).daily_limit, 9999);
    assert.equal((await one('SELECT is_available FROM public.menu_items WHERE id=$1', [s.item])).is_available, false);
    assert.equal((await one('SELECT daily_limit FROM public.menu_items WHERE id=$1', [s.twin])).daily_limit, 3);
    assert.equal((await one('SELECT is_available FROM public.menu_items WHERE id=$1', [other.item])).is_available, true);

    assert.equal((await failure(db, null, 'SELECT public.pos_menu($1)', ['afy_' + '0'.repeat(64)]))?.code, '42501');
    assert.equal((await failure(db, null, 'SELECT public.pos_set_availability($1, $2::jsonb)', [key, JSON.stringify([{ id: s.item, available: 'hayır' }])]))?.code, '22023');
    const rotated = (await as(db, s.uid, 'SELECT public.rotate_pos_credentials() AS r')).rows[0].r;
    assert.notEqual(rotated.api_key, key);
    assert.equal((await failure(db, null, 'SELECT public.pos_menu($1)', [key]))?.code, '42501');
    assert.equal((await as(db, null, 'SELECT count(*)::int n FROM public.pos_menu($1)', [rotated.api_key])).rows[0].n, 3);
    // Kapatılan bağlantının anahtarı çalışmaz.
    await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', false)`);
    assert.equal((await failure(db, null, 'SELECT public.pos_menu($1)', [rotated.api_key]))?.code, '42501');
    await as(db, s.uid, 'SELECT public.delete_pos_integration()');
    assert.equal((await one('SELECT count(*)::int n FROM public.seller_integrations WHERE seller_id=$1', [s.id])).n, 0);
  });

  test("kabul edilen değişiklik POS'a güncel kalemlerle gider", async () => {
    const s = await seller();
    await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', true)`);
    const buyer = await user();
    const o = await idem(buyer, s, randomUUID());
    await as(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]);
    const item = await one('SELECT * FROM public.order_items WHERE order_id=$1', [o.id]);
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution($1,$2,NULL,'Bitti')`, [item.id, s.twin])).rows[0];
    await as(db, buyer, 'SELECT public.respond_item_substitution($1, true)', [sub.id]);
    const log = (await as(db, s.uid, 'SELECT * FROM public.pos_delivery_log()')).rows;
    assert.equal(log[0].event, 'order.updated');
  });

  test('50\'den kalan anahtarsız kayıt kaydedilince anahtar alır', async () => {
    const s = await seller();
    await db.query(`INSERT INTO public.seller_integrations (seller_id, provider, external_id) VALUES ($1, 'pos', 'eski')`, [s.id]);
    const r = (await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', true) AS r`)).rows[0].r;
    assert.match(r.api_key, /^afy_/);
  });

  test('deneme gönderimi kaydedilir ve dakikada 5 ile sınırlı', async () => {
    const s = await seller();
    assert.equal((await failure(db, s.uid, 'SELECT public.test_pos_webhook()'))?.code, 'P0002');
    await as(db, s.uid, `SELECT public.save_pos_integration('https://pos.ornek.com/hook', true)`);
    for (let i = 0; i < 5; i++) await as(db, s.uid, 'SELECT public.test_pos_webhook()');
    assert.equal((await failure(db, s.uid, 'SELECT public.test_pos_webhook()'))?.code, '55000');
  });
});
