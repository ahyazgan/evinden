import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOpenAt, istanbulClock } from '../../lib/date.ts';
import { orderTotalCents } from '../../lib/pricing.ts';
import { orderBalanceCents, orderNetCents } from '../../lib/earnings.ts';
import {
  compareSellerOrders,
  isPickup,
  mapsUrl,
  MAX_TIP_CENTS,
  MEAL_CARDS,
  mealCardLabels,
  nextOrderLabel,
  nextOrderStatus,
  paymentLabel,
  sellerAddress,
  TIP_PRESETS_CENTS,
  toggleMealCard,
} from '../../lib/order-options.ts';
import {
  answerableAt,
  plannedLabel,
  scheduleDays,
  scheduledLabel,
  SCHEDULE_BUFFER_MINUTES,
  SCHEDULE_MIN_LEAD_MINUTES,
} from '../../lib/schedule-slots.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const openFor = (hours) => (at) => isOpenAt(hours, istanbulClock(at));
const allDay = () => true;

// 2026-11-04 Çarşamba, İstanbul 12:10
const NOW = new Date('2026-11-04T09:10:00Z');
const WED = 2;

describe('planlı sipariş saatleri', () => {
  test('ilk saat 45 dakika ve pay sonrası ilk yarım saat', () => {
    const first = scheduleDays(allDay, NOW)[0].slots[0];
    assert.equal(first.time, '13:00');
    assert.equal(first.iso, '2026-11-04T10:00:00.000Z');
    const lead = (new Date(first.iso).getTime() - NOW.getTime()) / MIN;
    assert.ok(lead >= SCHEDULE_MIN_LEAD_MINUTES + SCHEDULE_BUFFER_MINUTES);
  });

  test('tam sınırda saat listede kalır, bir dakika öncesi atlanır', () => {
    // 11:10 + 50 dk = 12:00 tam adım
    const exact = new Date('2026-11-04T08:10:00Z');
    assert.equal(scheduleDays(allDay, exact)[0].slots[0].time, '12:00');
    const after = new Date('2026-11-04T08:11:00Z');
    assert.equal(scheduleDays(allDay, after)[0].slots[0].time, '12:30');
  });

  test('saatler 30 dakika arayla, yedinci günü geçmez', () => {
    const days = scheduleDays(allDay, NOW);
    const slots = days.flatMap((d) => d.slots).map((s) => new Date(s.iso).getTime());
    for (let i = 1; i < slots.length; i += 1) assert.equal(slots[i] - slots[i - 1], 30 * MIN);
    for (const ms of slots) assert.equal(new Date(ms).getUTCMinutes() % 30, 0);
    assert.ok(slots[slots.length - 1] <= NOW.getTime() + 7 * DAY);
    assert.ok(slots[slots.length - 1] + 30 * MIN > NOW.getTime() + 7 * DAY);
    assert.equal(days.length, 8, 'bugün ve sonraki yedi takvim günü');
  });

  test('çalışma saatine uyar: açılış dahil, kapanış hariç', () => {
    const hours = [{ day_of_week: WED + 1, open_time: '09:00:00', close_time: '11:00:00', is_open: true }];
    for (const d of [0, 1, 2, 4, 5, 6]) hours.push({ day_of_week: d, open_time: null, close_time: null, is_open: false });
    const days = scheduleDays(openFor(hours), NOW);
    assert.equal(days.length, 1);
    assert.equal(days[0].label, 'Yarın');
    assert.deepEqual(days[0].slots.map((s) => s.time), ['09:00', '09:30', '10:00', '10:30']);
  });

  test('açılış saati sunulmaz: sipariş restoran açılmadan 15 dakika kuralıyla iptal olurdu', () => {
    const hours = [{ day_of_week: WED + 1, open_time: '09:00:00', close_time: '11:00:00', is_open: true }];
    for (const d of [0, 1, 2, 4, 5, 6]) hours.push({ day_of_week: d, open_time: null, close_time: null, is_open: false });
    const days = scheduleDays(answerableAt(openFor(hours)), NOW);
    assert.deepEqual(days[0].slots.map((s) => s.time), ['09:30', '10:00', '10:30']);
  });

  test('saat girilmemiş satıcıda bütün saatler kalır', () => {
    assert.deepEqual(scheduleDays(answerableAt(allDay), NOW), scheduleDays(allDay, NOW));
  });

  test('kapalı gün listelenmez, saat girilmemiş satıcı açık sayılır', () => {
    const closed = [{ day_of_week: WED, open_time: null, close_time: null, is_open: false }];
    const days = scheduleDays(openFor(closed), NOW);
    assert.ok(days.every((d) => d.dateKey !== '2026-11-04'));
    assert.ok(scheduleDays(openFor([]), NOW).length > 0);
  });

  test('gece yarısını aşan saat ertesi günün başına düşer', () => {
    const hours = [{ day_of_week: WED + 1, open_time: '22:00:00', close_time: '01:00:00', is_open: true }];
    for (const d of [0, 1, 2, 4, 5, 6]) hours.push({ day_of_week: d, open_time: null, close_time: null, is_open: false });
    const days = scheduleDays(openFor(hours), NOW);
    assert.deepEqual(days.map((d) => d.dateKey), ['2026-11-05', '2026-11-06']);
    assert.deepEqual(days[0].slots.map((s) => s.time), ['22:00', '22:30', '23:00', '23:30']);
    assert.deepEqual(days[1].slots.map((s) => s.time), ['00:00', '00:30']);
  });

  test('gün İstanbul saatine göre ayrılır', () => {
    // UTC 20:30 = İstanbul 23:30: 21:00 UTC yeni güne denk gelir
    const late = new Date('2026-11-04T20:30:00Z');
    const days = scheduleDays(allDay, late);
    assert.equal(days[0].dateKey, '2026-11-05');
    assert.equal(days[0].label, 'Yarın');
    assert.equal(days[0].slots[0].time, '00:30');
    assert.equal(days[1].label, 'Cum 6 Kas');
  });

  test('telefonun saat diliminden etkilenmez', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      assert.equal(scheduleDays(allDay, NOW)[0].slots[0].time, '13:00');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  test('açık saat yoksa liste boş', () => {
    assert.deepEqual(scheduleDays(() => false, NOW), []);
  });

  test('etiket: bugün, yarın, tarih', () => {
    assert.equal(scheduledLabel('2026-11-04T10:30:00Z', NOW), 'bugün 13:30');
    assert.equal(plannedLabel('2026-11-05T09:30:00Z', NOW), 'Planlı: yarın 12:30');
    assert.equal(plannedLabel('2026-11-07T09:30:00Z', NOW), 'Planlı: Cmt 7 Kas 12:30');
    assert.equal(scheduledLabel('2026-11-04T21:30:00Z', NOW), 'yarın 00:30', 'İstanbul takvimiyle ertesi gün');
  });

  test('sunucu sınırları kaynaktakiyle aynı', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/033_order_options.sql', import.meta.url), 'utf8');
    assert.match(sql, /now\(\) \+ interval '45 minutes'/);
    assert.match(sql, /now\(\) \+ interval '7 days'/);
    assert.equal(SCHEDULE_MIN_LEAD_MINUTES, 45);
  });
});

describe('yemek kartı', () => {
  test('liste veritabanı kısıtıyla aynı', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/033_order_options.sql', import.meta.url), 'utf8');
    const known = sql.match(/meal_cards <@ ARRAY\[([^\]]+)\]/)[1].match(/'[a-z]+'/g).map((v) => v.replaceAll("'", ''));
    assert.deepEqual(MEAL_CARDS.map((c) => c.id).sort(), known.sort());
  });
  test('Edenred, Ticket Restaurant olarak görünür', () => {
    assert.deepEqual(mealCardLabels(['edenred', 'multinet']), ['Multinet', 'Ticket Restaurant']);
    assert.deepEqual(mealCardLabels(null), []);
    assert.deepEqual(mealCardLabels(['sahte']), []);
  });
  test('seçim açılıp kapanır', () => {
    assert.deepEqual(toggleMealCard([], 'pluxee'), ['pluxee']);
    assert.deepEqual(toggleMealCard(['pluxee', 'setcard'], 'pluxee'), ['setcard']);
  });
});

describe('ödeme adları', () => {
  test('teslimatta kapıda, gelip almada kasada', () => {
    assert.equal(paymentLabel('cash'), 'Nakit');
    assert.equal(paymentLabel('card_door'), 'Kapıda kart');
    assert.equal(paymentLabel('meal_card_door'), 'Kapıda yemek kartı');
    assert.equal(paymentLabel('card_door', 'pickup'), 'Kasada kart');
    assert.equal(paymentLabel('meal_card_door', 'pickup'), 'Kasada yemek kartı');
    assert.equal(paymentLabel('cash', 'pickup'), 'Kasada nakit');
    assert.equal(paymentLabel('online', 'pickup'), 'Online ödeme');
  });
  test('boş nakit sayılır, bilinmeyen olduğu gibi yazılır', () => {
    assert.equal(paymentLabel(null), 'Nakit');
    assert.equal(paymentLabel('havale'), 'havale');
  });
  test('sunucunun kabul ettiği yöntemlerin hepsinin adı var', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/033_order_options.sql', import.meta.url), 'utf8');
    const methods = sql.match(/p_payment_method NOT IN \(([^)]+)\)/)[1].match(/'[a-z_]+'/g).map((v) => v.replaceAll("'", ''));
    assert.equal(methods.length, 4);
    for (const m of methods) assert.notEqual(paymentLabel(m), m);
  });
});

describe('gelip alma akışı', () => {
  const pickup = (status) => ({ status, fulfillment: 'pickup' });
  const delivery = (status) => ({ status, fulfillment: 'delivery' });

  test('hazırdan sonra müşteri alır', () => {
    assert.equal(nextOrderStatus(pickup('ready')), 'delivered');
    assert.equal(nextOrderLabel(pickup('ready')), 'Müşteri aldı');
    assert.equal(isPickup(pickup('ready')), true);
  });
  test('teslimatta akış değişmez', () => {
    assert.equal(nextOrderStatus(delivery('ready')), 'out_for_delivery');
    assert.equal(nextOrderLabel(delivery('ready')), 'Yola çıktı');
    assert.equal(nextOrderStatus(delivery('out_for_delivery')), 'delivered');
    assert.equal(nextOrderLabel(delivery('out_for_delivery')), 'Teslim edildi');
    assert.equal(nextOrderStatus({ status: 'ready' }), 'out_for_delivery', 'eski sipariş teslimattır');
    assert.equal(nextOrderStatus(delivery('delivered')), null);
  });
  test('hiçbir adım gelip almada yola çıkarmaz', () => {
    for (const s of ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled']) {
      assert.notEqual(nextOrderStatus(pickup(s)), 'out_for_delivery');
    }
  });
  test('harita bağlantısı konumu, yoksa adresi kullanır', () => {
    assert.equal(mapsUrl({ latitude: 41.1, longitude: 29.2 }), 'https://www.google.com/maps/search/?api=1&query=41.1%2C29.2');
    const seller = { address_line: 'Moda Cad. 1', district: 'Kadıköy', city: 'İstanbul' };
    assert.equal(sellerAddress(seller), 'Moda Cad. 1, Kadıköy, İstanbul');
    assert.ok(mapsUrl(seller).includes(encodeURIComponent('Moda Cad. 1, Kadıköy, İstanbul')));
    assert.equal(mapsUrl({}), null);
    assert.equal(mapsUrl(null), null);
  });
});

describe('bahşiş', () => {
  test('sunucu sınırıyla aynı, hazır tutarlar sınırın altında', () => {
    assert.equal(MAX_TIP_CENTS, 50000);
    assert.deepEqual(TIP_PRESETS_CENTS, [1000, 2000, 3000]);
  });
  test('tutar: indirim bahşişi yemez', () => {
    assert.equal(orderTotalCents({ subtotalCents: 10000, deliveryFeeCents: 1500, discountCents: 0, tipCents: 2000 }), 13500);
    assert.equal(orderTotalCents({ subtotalCents: 10000, deliveryFeeCents: 0, discountCents: 20000, tipCents: 1000 }), 1000);
  });
  test('net hesabında tamamı satıcının, kapıda bakiyeye etkisi yok', () => {
    const order = { subtotal_cents: 10000, delivery_fee_cents: 1500, commission_cents: 800, tip_cents: 2000, total_cents: 13500 };
    assert.equal(orderNetCents(order), 12700);
    for (const method of ['cash', 'card_door', 'meal_card_door']) {
      assert.equal(orderBalanceCents({ ...order, payment_method: method }), -800);
    }
    assert.equal(orderBalanceCents({ ...order, payment_method: 'online' }), 12700);
  });
  test('eski siparişte bahşiş yok sayılır', () => {
    assert.equal(orderNetCents({ subtotal_cents: 10000, delivery_fee_cents: 0, total_cents: 10000 }), 10000);
  });
});

describe('satıcı sırası', () => {
  const now = Date.parse('2026-11-04T09:00:00Z');
  const at = (mins) => new Date(now + mins * MIN).toISOString();
  const sort = (list) => [...list].sort((a, b) => compareSellerOrders(a, b, now)).map((o) => o.id);

  test('saati yaklaşan planlı, normal, ileri planlı, biten', () => {
    const list = [
      { id: 'biten', status: 'delivered', created_at: at(-1) },
      { id: 'ileri2', status: 'accepted', created_at: at(-5), scheduled_for: at(3000) },
      { id: 'normal-eski', status: 'preparing', created_at: at(-30) },
      { id: 'ileri1', status: 'pending', created_at: at(-2), scheduled_for: at(600) },
      { id: 'normal-yeni', status: 'pending', created_at: at(-3) },
      { id: 'yakin', status: 'accepted', created_at: at(-400), scheduled_for: at(45) },
    ];
    assert.deepEqual(sort(list), ['yakin', 'normal-yeni', 'normal-eski', 'ileri1', 'ileri2', 'biten']);
  });

  test('biten siparişler yeniden eskiye, planlı saati geçmiş olan öne çıkar', () => {
    const list = [
      { id: 'a', status: 'delivered', created_at: at(-50), scheduled_for: at(-10) },
      { id: 'b', status: 'cancelled', created_at: at(-5) },
      { id: 'c', status: 'ready', created_at: at(-100), scheduled_for: at(-5) },
    ];
    assert.deepEqual(sort(list), ['c', 'b', 'a']);
  });
});
