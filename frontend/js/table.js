// table.js — renders the dense neon data table.
//
// renderTable(container, result, fieldsIndex)
//   container   the #table-host element
//   result      {count, rows, columns, meta} from /api/screen
//   fieldsIndex map of fieldId -> {id,label,group,type,unit}
//
// Builds a sticky-header table from result.columns / result.rows. Numerics are
// right-aligned in mono and change-like columns are sign-colored. Clicking a
// row dispatches a global 'screener:rowclick' CustomEvent with the row object.
//
// Exports TableView (a thin stateful wrapper) and renderTable (one-shot).

import { formatValue, isNumericType, signClass } from './format.js';

// Columns we never want to show as their own cell. The backend always returns
// "ticker" (exchange-prefixed) first; we surface "name" as the primary symbol
// and keep "ticker" only as a data attribute for the detail drawer.
const HIDDEN_COLUMNS = new Set(['ticker']);

function labelFor(colId, fieldsIndex) {
  const meta = fieldsIndex[colId];
  if (meta && meta.label) return meta.label;
  // Stat / computed / factor columns have no catalog entry. Use the id.
  return colId;
}

function buildHeader(columns, fieldsIndex) {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const colId of columns) {
    if (HIDDEN_COLUMNS.has(colId)) continue;
    const th = document.createElement('th');
    const meta = fieldsIndex[colId];
    const numeric = meta ? isNumericType(meta.type) : !['name', 'description', 'sector', 'industry', 'exchange', 'country', 'currency', 'type'].includes(colId);
    if (numeric) th.classList.add('num');
    if (colId === 'name') th.classList.add('col-name');
    th.dataset.col = colId;
    th.textContent = labelFor(colId, fieldsIndex);
    th.title = colId;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  return thead;
}

function buildBody(columns, rows, fieldsIndex) {
  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.ticker = row.ticker || row.name || '';
    for (const colId of columns) {
      if (HIDDEN_COLUMNS.has(colId)) continue;
      const td = document.createElement('td');
      const meta = fieldsIndex[colId];
      const value = row[colId];
      const numeric = typeof value === 'number' || (meta && isNumericType(meta.type));

      if (colId === 'name') {
        td.classList.add('col-name');
      } else if (numeric) {
        td.classList.add('num');
        const sc = signClass(value, meta, colId);
        if (sc) td.classList.add(sc);
      } else {
        td.classList.add('str');
      }

      if (value == null) td.classList.add('is-null');
      td.textContent = value == null ? '·' : formatValue(value, meta);
      tr.appendChild(td);
    }
    // Row click -> global event for the detail drawer module.
    tr.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('screener:rowclick', { detail: row }));
    });
    tbody.appendChild(tr);
  });
  return tbody;
}

// One-shot render. Clears container and draws header + body, or an empty card.
export function renderTable(container, result, fieldsIndex) {
  container.innerHTML = '';
  const cols = (result && result.columns) || [];
  const rows = (result && result.rows) || [];

  if (!rows.length) {
    container.appendChild(emptyCard(result));
    return;
  }

  const table = document.createElement('table');
  table.className = 'screener-table';
  table.appendChild(buildHeader(cols, fieldsIndex));
  table.appendChild(buildBody(cols, rows, fieldsIndex));
  container.appendChild(table);
}

function emptyCard(result) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-card';
  const err = result && result.meta && result.meta.error;
  const title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = err ? 'QUERY ERROR' : 'NO MATCHES';
  const body = document.createElement('div');
  body.textContent = err
    ? String(err)
    : 'No rows came back for this scan. Loosen the filters or pick another market.';
  wrap.appendChild(title);
  wrap.appendChild(body);
  return wrap;
}

// Stateful view: keeps its container + fieldsIndex so modules can call
// view.render(result) repeatedly.
export class TableView {
  constructor(container, fieldsIndex) {
    this.container = container;
    this.fieldsIndex = fieldsIndex || {};
  }

  setFieldsIndex(fieldsIndex) {
    this.fieldsIndex = fieldsIndex || {};
  }

  render(result) {
    renderTable(this.container, result, this.fieldsIndex);
  }
}

export default { renderTable, TableView };
