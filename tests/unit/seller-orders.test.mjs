import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsSince, dashboardStatsSince, mergeOrdersById, nextCursor, olderThanFilter, topCustomerOrderIds } from '../../lib/seller-orders.ts';

describe('Restoran sipariş sayfalama', () => {
  test('eksik sayfada devam yok, tam sayfada imleç son satır', () => {
    const page = [{ id: 'a', created_at: '2026-11-02' }, { id: 'b', created_at: '2026-11-01' }];
    assert.equal(nextCursor(page, 3), null);
    assert.deepEqual(nextCursor(page, 2), { id: 'b', created_at: '2026-11-01' });
  });

  test('imleç filtresi aynı anda açılan siparişi atlamaz, tarihi tırnaklar', () => {
    const filter = olderThanFilter({ created_at: '2026-11-01T10:00:00.123+00:00', id: 'x' });
    assert.equal(filter, 'created_at.lt."2026-11-01T10:00:00.123+00:00",and(created_at.eq."2026-11-01T10:00:00.123+00:00",id.lt.x)');
  });

  test('birleştirmede güncel liste kazanır, sıra korunur', () => {
    const fresh = [{ id: 'a', status: 'delivered' }];
    const older = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'cancelled' }];
    assert.deepEqual(mergeOrdersById(fresh, older), [{ id: 'a', status: 'delivered' }, { id: 'b', status: 'cancelled' }]);
  });
});

describe('İstatistik aralıkları', () => {
  test('hafta önceki ayda başlıyorsa analiz haftadan başlar', () => {
    // 2026-11-01 Pazar: hafta 26 Ekim Pazartesi başlar.
    const since = analyticsSince(new Date(2026, 10, 1, 12));
    assert.deepEqual([since.getMonth(), since.getDate()], [9, 26]);
  });

  test('ay ortasında analiz ayın başından başlar', () => {
    const since = analyticsSince(new Date(2026, 10, 18, 12));
    assert.deepEqual([since.getMonth(), since.getDate()], [10, 1]);
  });

  test('panel son 30 günü gün başından alır', () => {
    const since = dashboardStatsSince(new Date(2026, 10, 30, 15));
    assert.deepEqual([since.getMonth(), since.getDate(), since.getHours()], [9, 31, 0]);
  });

  test('en çok sipariş veren müşterilerin birer siparişi seçilir', () => {
    const ids = topCustomerOrderIds([
      { id: '1', customer_id: 'x' }, { id: '2', customer_id: 'y' }, { id: '3', customer_id: 'y' },
      { id: '4', customer_id: null }, { id: '5', customer_id: 'z' },
    ], 2);
    assert.deepEqual(ids, ['2', '1']);
  });
});
