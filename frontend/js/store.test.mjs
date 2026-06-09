// store.test.mjs — headless logic tests for state.js + format.js.
// Run with: node --test frontend/js/store.test.mjs
//           (or plain: node frontend/js/store.test.mjs)
//
// state.js imports api.js which calls fetch. We never call runScreen here, so
// fetch is not invoked. We stub a no-op global fetch just in case so importing
// stays safe in a bare Node runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
}

const { createStore } = await import('./state.js');
const format = await import('./format.js');

// ---------------- state.js ----------------

test('store.set shallow-merges and notifies subscribers', () => {
  const store = createStore();
  let seen = null;
  const unsub = store.subscribe((s) => { seen = s.market; });
  store.set({ market: 'crypto' });
  assert.equal(store.state.market, 'crypto');
  assert.equal(seen, 'crypto');
  unsub();
  store.set({ market: 'forex' });
  assert.equal(seen, 'crypto', 'unsubscribe stops notifications');
});

test('store.update sets a single key and notifies', () => {
  const store = createStore();
  let count = 0;
  store.subscribe(() => { count += 1; });
  store.update('limit', 50);
  assert.equal(store.state.limit, 50);
  assert.equal(count, 1);
});

test('store.indexFields builds a fieldIndex by id', () => {
  const store = createStore();
  store.indexFields([
    { id: 'close', label: 'Price', type: 'price', unit: '$' },
    { id: 'change', label: 'Change %', type: 'pct', unit: '%' },
  ]);
  assert.equal(store.state.fieldIndex.close.label, 'Price');
  assert.equal(store.state.fieldIndex.change.type, 'pct');
});

test('store.buildScreenBody omits empty optional sections', () => {
  const store = createStore();
  store.set({ market: 'america', columns: ['name', 'close'], sort: [{ field: 'close', dir: 'desc' }] });
  const body = store.buildScreenBody();
  assert.equal(body.market, 'america');
  assert.deepEqual(body.columns, ['name', 'close']);
  assert.equal(body.match, 'all');
  assert.equal('computed' in body, false);
  assert.equal('stats' in body, false);
  assert.equal('factor' in body, false);
});

test('store.buildScreenBody includes computed/stats/factor when present', () => {
  const store = createStore();
  store.set({
    computed: [{ id: 'r', expr: '(high-low)/close' }],
    stats: [{ fn: 'zscore', field: 'change' }],
    factor: { weights: [{ field: 'change', weight: 1, dir: 'high' }] },
  });
  const body = store.buildScreenBody();
  assert.equal(body.computed.length, 1);
  assert.equal(body.stats[0].fn, 'zscore');
  assert.equal(body.factor.weights[0].field, 'change');
});

test('store.subscribe survives a throwing subscriber', () => {
  const store = createStore();
  let reached = false;
  store.subscribe(() => { throw new Error('boom'); });
  store.subscribe(() => { reached = true; });
  store.set({ market: 'bond' });
  assert.equal(reached, true);
});

// ---------------- format.js ----------------

test('bignum formats with K/M/B/T suffixes', () => {
  assert.equal(format.bignum(4983883505419), '4.98T');
  assert.equal(format.bignum(1.2e9), '1.20B');
  assert.equal(format.bignum(945e6), '945.00M');
  assert.equal(format.bignum(12340), '12.3K');
  assert.equal(format.bignum(-1.5e9), '-1.50B');
});

test('pct carries an explicit sign and percent suffix', () => {
  assert.equal(format.pct(1.29), '+1.29%');
  assert.equal(format.pct(-1.29), '-1.29%');
  assert.equal(format.pct(0), '0.00%');
});

test('price uses 2 decimals, more for sub-dollar', () => {
  assert.equal(format.price(205.9456), '205.95');
  assert.equal(format.price(0.1234), '0.1234');
});

test('formatValue applies unit prefixes/suffixes', () => {
  assert.equal(format.formatValue(205.95, { type: 'price', unit: '$' }), '$205.95');
  assert.equal(format.formatValue(12.5, { type: 'num', unit: 'x' }), '12.50x');
  assert.equal(format.formatValue(-1.29, { type: 'pct', unit: '%' }), '-1.29%');
  assert.equal(format.formatValue(null, { type: 'price' }), '');
});

test('formatValue handles unknown computed/stat columns numerically', () => {
  assert.equal(format.formatValue(2.5, undefined), '2.50');
  assert.equal(format.formatValue(7, undefined), '7');
});

test('signClass colors pct and change fields by sign only', () => {
  assert.equal(format.signClass(1.2, { type: 'pct' }, 'change'), 'sign-pos');
  assert.equal(format.signClass(-1.2, { type: 'pct' }, 'change'), 'sign-neg');
  assert.equal(format.signClass(100, { type: 'price' }, 'close'), '', 'price is not sign-colored');
  assert.equal(format.signClass(3.1, undefined, 'factor_score'), 'sign-pos');
});

test('isNumericType is true for numeric types and false for str', () => {
  assert.equal(format.isNumericType('price'), true);
  assert.equal(format.isNumericType('pct'), true);
  assert.equal(format.isNumericType('str'), false);
});
