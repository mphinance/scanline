// api.test.mjs - error parsing and the store's failed-refresh behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
globalThis.fetch = async (url, init) => calls.shift()(url, init);
const reply = (status, body, statusText = '') => async () => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => {
    if (body === undefined) throw new Error('no json');
    return body;
  },
});

const api = await import('./api.js');
const { createStore } = await import('./state.js');

test('messageFromBody prefers detail, then meta.error', () => {
  assert.equal(api.messageFromBody({ detail: 'bad market' }), 'bad market');
  assert.equal(api.messageFromBody({ meta: { error: 'tv down' } }), 'tv down');
  assert.equal(api.messageFromBody({ detail: 'a', meta: { error: 'b' } }), 'a');
  assert.equal(api.messageFromBody({ detail: { message: 'obj' } }), 'obj');
  assert.equal(api.messageFromBody(null), '');
  assert.equal(
    api.messageFromBody({ detail: [{ loc: ['body', 'limit'], msg: 'too big' }] }),
    'limit: too big'
  );
});

test('describeFailure falls back to a readable sentence', () => {
  assert.match(api.describeFailure(502, 'Bad Gateway', null), /unavailable/);
  assert.match(api.describeFailure(500, 'Oops', null), /500 Oops/);
  assert.equal(api.describeFailure(400, '', { detail: 'nope' }), 'nope');
});

test('formatLatency never prints undefined', () => {
  assert.equal(api.formatLatency({ ms: 12.4 }), '12ms');
  assert.equal(api.formatLatency({ ms: 12, cached: true }), '12ms cached');
  assert.equal(api.formatLatency({}), '--');
  assert.equal(api.formatLatency(undefined), '--');
});

test('screen surfaces the server detail on a 502', async () => {
  calls.push(reply(502, { detail: 'TradingView timed out', meta: { error: 'x' } }));
  await assert.rejects(api.screen({}), (e) => e.status === 502 && e.message === 'TradingView timed out');
});

test('network failure gives a readable message', async () => {
  calls.push(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(api.screen({}), (e) => e.message === api.NETWORK_MESSAGE);
});

test('a failed refresh keeps the previous table', async () => {
  const store = createStore();
  const good = { count: 1, rows: [{ name: 'A' }], columns: ['name'], meta: { ms: 5 } };
  calls.push(reply(200, good));
  await store.runScreen();
  assert.equal(store.state.result, good);
  calls.push(reply(502, { detail: 'upstream down' }));
  await store.runScreen();
  assert.equal(store.state.result, good);
  assert.equal(store.state.error, 'upstream down');
  assert.equal(store.state.keptPrevious, true);
});

test('first-run failure yields an error result, not a kept table', async () => {
  const store = createStore();
  calls.push(reply(200, { count: 0, rows: [], columns: [], meta: { error: 'bad filter' } }));
  await store.runScreen();
  assert.equal(store.state.error, 'bad filter');
  assert.equal(store.state.keptPrevious, false);
  assert.equal(store.state.result.meta.error, 'bad filter');
});
