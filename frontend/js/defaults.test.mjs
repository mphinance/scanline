import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultField } from './defaults.js';

const fields = [{ id: 'employees' }, { id: 'change' }, { id: 'close' }];

test('starts on Price, then Change %', () => {
  assert.equal(pickDefaultField(fields), 'close');
  assert.equal(pickDefaultField(fields, ['close']), 'change');
});

test('falls back to the first unused field', () => {
  assert.equal(pickDefaultField(fields, ['close', 'change']), 'employees');
  assert.equal(pickDefaultField([{ id: 'x' }], ['x']), 'x');
  assert.equal(pickDefaultField([]), '');
});
