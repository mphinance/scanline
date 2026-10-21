import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeInfo, REALTIME_DOC_URL } from './mode.js';

test('known modes map to their label', () => {
  assert.equal(modeInfo('realtime').label, 'REAL-TIME');
  assert.equal(modeInfo('cookie_rejected').tone, 'rejected');
  assert.equal(modeInfo('delayed').mode, 'delayed');
});

test('missing or unknown mode shows delayed', () => {
  for (const v of [undefined, null, '', 'bogus', 42, '__proto__']) {
    assert.equal(modeInfo(v).mode, 'delayed');
  }
});

test('every mode links the realtime doc', () => {
  assert.equal(modeInfo('delayed').url, REALTIME_DOC_URL);
  assert.match(REALTIME_DOC_URL, /docs\/REALTIME\.md$/);
});
