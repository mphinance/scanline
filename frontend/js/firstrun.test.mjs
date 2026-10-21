import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowFirstRun, dismissFirstRun } from './firstrun.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('shows until dismissed, then stays hidden', () => {
  const st = memStore();
  assert.equal(shouldShowFirstRun(st), true);
  dismissFirstRun(st);
  assert.equal(shouldShowFirstRun(st), false);
});

test('broken storage never throws and shows the strip', () => {
  const bad = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(shouldShowFirstRun(bad), true);
  assert.doesNotThrow(() => dismissFirstRun(bad));
});
