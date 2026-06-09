// state.js — central singleton store for the screener.
//
// PUBLIC API (later feature modules depend on this exact surface):
//   store.state                      live state object (read; never mutate directly)
//   store.get()                      -> shallow copy of state
//   store.set(patch)                 shallow-merge patch into state, then notify
//   store.update(path, value)        set one key (dotless top-level path) then notify
//   store.subscribe(fn)              fn(state) on every change; returns unsubscribe()
//   store.buildScreenBody()          -> POST body for /api/screen from current state
//   store.runScreen()                async; sets loading, calls api.screen, stores result
//   store.setMarket(marketId)        convenience: switch market + reset columns + run
//   store.indexFields(fieldsArray)   build fieldIndex from a fields array
//
// State shape:
//   { market, columns:[], filters:[], match:'all', computed:[], stats:[],
//     factor:null, sort:[], limit, offset,
//     result:null, fields:[], fieldIndex:{}, markets:[], presets:[],
//     factorPresets:[], loading:false, error:null }

import api from './api.js';

function createStore() {
  const state = {
    market: 'america',
    columns: [],
    filters: [],
    match: 'all',
    computed: [],
    stats: [],
    factor: null,
    sort: [],
    limit: 150,
    offset: 0,

    result: null,
    fields: [],
    fieldIndex: {},
    markets: [],
    presets: [],
    factorPresets: [],
    loading: false,
    error: null,
  };

  const subscribers = new Set();

  function notify() {
    for (const fn of subscribers) {
      try {
        fn(state);
      } catch (err) {
        // A broken subscriber must not break the others or the store.
        console.error('store subscriber threw:', err);
      }
    }
  }

  const store = {
    state,

    get() {
      return { ...state };
    },

    set(patch) {
      Object.assign(state, patch);
      notify();
      return store;
    },

    update(path, value) {
      state[path] = value;
      notify();
      return store;
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // Build the index of fieldId -> meta for fast formatter/label lookup.
    indexFields(fieldsArray) {
      const idx = {};
      for (const f of fieldsArray || []) idx[f.id] = f;
      state.fields = fieldsArray || [];
      state.fieldIndex = idx;
      return idx;
    },

    // Assemble the /api/screen request body from current state. Omits empty
    // optional sections so the payload stays clean.
    buildScreenBody() {
      const body = {
        market: state.market,
        columns: state.columns.slice(),
        filters: state.filters.slice(),
        match: state.match,
        sort: state.sort.slice(),
        limit: state.limit,
        offset: state.offset,
      };
      if (state.computed && state.computed.length) body.computed = state.computed.slice();
      if (state.stats && state.stats.length) body.stats = state.stats.slice();
      if (state.factor && state.factor.weights && state.factor.weights.length) {
        body.factor = state.factor;
      }
      return body;
    },

    // Run the screen. Sets loading true, clears error, calls the API, then
    // stores result/error and loading false. Always notifies twice (start,
    // finish) so spinners and status bars track the request lifecycle.
    async runScreen() {
      state.loading = true;
      state.error = null;
      notify();
      try {
        const result = await api.screen(store.buildScreenBody());
        state.result = result;
        // Backend returns 200 with meta.error on a bad query.
        state.error = (result && result.meta && result.meta.error) || null;
      } catch (err) {
        state.result = { count: 0, rows: [], columns: [], meta: { error: String(err.message || err) } };
        state.error = String(err.message || err);
      } finally {
        state.loading = false;
        notify();
      }
      return state.result;
    },

    // Switch market: set it, clear sort/offset (columns get reset by app.js
    // via the default-columns helper it passes in), then run.
    setMarket(marketId, defaultColumns) {
      state.market = marketId;
      state.offset = 0;
      state.sort = [];
      if (Array.isArray(defaultColumns)) state.columns = defaultColumns.slice();
      notify();
      return store.runScreen();
    },
  };

  return store;
}

// Singleton.
const store = createStore();
export default store;
export { store, createStore };
