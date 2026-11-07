import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpsLabel, qualityLevel } from '../../lib/growth-format.ts';

test('baz puan yüzde metnine çevrilir', () => {
  assert.equal(bpsLabel(1250), '%12,5');
  assert.equal(bpsLabel(0), '%0');
  assert.equal(bpsLabel(-340), '%-3,4');
});

test('kalite seviyesi: az siparişte yeni, sonra eşiklere göre', () => {
  assert.equal(qualityLevel(50, 3), 'new');
  assert.equal(qualityLevel(85, 10), 'good');
  assert.equal(qualityLevel(70, 10), 'watch');
  assert.equal(qualityLevel(40, 10), 'risk');
});
