import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly, loadProfileRow, READ_ATTEMPTS } from '../../lib/profile-load.ts';

const ROW = { id: 'u1', role: 'seller' };
const noWait = async () => {};

function deps(reads, inserts = []) {
  const calls = { read: 0, insert: 0 };
  return {
    calls,
    read: async () => reads[Math.min(calls.read++, reads.length - 1)],
    insert: async () => inserts[Math.min(calls.insert++, inserts.length - 1)],
    wait: noWait,
  };
}

describe('loadProfileRow', () => {
  test('satır varsa oluşturmaz', async () => {
    const d = deps([{ data: ROW, error: null }]);
    assert.equal(await loadProfileRow(d), ROW);
    assert.equal(d.calls.insert, 0);
  });

  test('okuma hatasında oluşturmaz, yeniden dener', async () => {
    const d = deps([{ data: null, error: { message: 'ağ' } }, { data: ROW, error: null }]);
    assert.equal(await loadProfileRow(d), ROW);
    assert.equal(d.calls.read, 2);
    assert.equal(d.calls.insert, 0);
  });

  test('okunamıyorsa null döner, rol uydurmaz', async () => {
    const d = deps([{ data: null, error: { message: 'ağ' } }]);
    assert.equal(await loadProfileRow(d), null);
    assert.equal(d.calls.read, READ_ATTEMPTS);
    assert.equal(d.calls.insert, 0);
  });

  test('satır yoksa oluşturur', async () => {
    const created = { id: 'u1', role: 'buyer' };
    const d = deps([{ data: null, error: null }], [{ data: created, error: null }]);
    assert.equal(await loadProfileRow(d), created);
  });

  test('aynı anda oluşturulmuşsa mevcut satırı okur', async () => {
    const d = deps(
      [{ data: null, error: null }, { data: ROW, error: null }],
      [{ data: null, error: { code: '23505', message: 'duplicate key' } }],
    );
    assert.equal(await loadProfileRow(d), ROW);
    assert.equal(d.calls.insert, 1);
  });

  test('oluşturma başka nedenle başarısızsa null döner', async () => {
    const d = deps([{ data: null, error: null }], [{ data: null, error: { code: '42501', message: 'yetki' } }]);
    assert.equal(await loadProfileRow(d), null);
  });
});

describe('latestOnly', () => {
  test('yalnızca son başlatılan geçerli kalır', () => {
    const begin = latestOnly();
    const first = begin();
    assert.equal(first(), true);
    const second = begin();
    assert.equal(first(), false);
    assert.equal(second(), true);
  });
});
