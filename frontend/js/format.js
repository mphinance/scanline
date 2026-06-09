// format.js — value formatters by field type.
// Pure functions, no DOM, no deps. Importable in Node for tests.
//
// Field types come from the backend catalog: "str", "int", "num", "pct",
// "price", "bignum". Each formatter returns a string. formatValue is the
// single entry point table.js uses.

// Format a big number with K/M/B/T suffixes, e.g. 1.2B, 945.0M.
export function bignum(v) {
  if (v == null || Number.isNaN(v)) return '';
  const n = Number(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + abs.toFixed(0);
}

// Price: 2 decimals, thousands separators. Sub-dollar gets more precision.
export function price(v) {
  if (v == null || Number.isNaN(v)) return '';
  const n = Number(v);
  const dec = Math.abs(n) < 1 ? 4 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Percent with explicit +/- sign and 2 decimals. Value is already a percent
// number (e.g. -1.29 means -1.29%).
export function pct(v) {
  if (v == null || Number.isNaN(v)) return '';
  const n = Number(v);
  const s = n.toFixed(2);
  return (n > 0 ? '+' : '') + s + '%';
}

// Plain number, 2 decimals, thousands separators.
export function num(v) {
  if (v == null || Number.isNaN(v)) return '';
  const n = Number(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Integer with thousands separators.
export function int(v) {
  if (v == null || Number.isNaN(v)) return '';
  return Math.round(Number(v)).toLocaleString('en-US');
}

// String passthrough, trimmed, empty for null.
export function str(v) {
  if (v == null) return '';
  return String(v);
}

// Map a field type to its formatter.
const FORMATTERS = { bignum, price, pct, num, int, str };

// The set of types that are right-aligned numeric.
const NUMERIC_TYPES = new Set(['bignum', 'price', 'pct', 'num', 'int']);

// Returns true when a field type should be right-aligned in the table.
export function isNumericType(type) {
  return NUMERIC_TYPES.has(type);
}

// Format one value given its field meta {type, unit}. Falls back to a
// best-effort by JS type when meta is missing (computed/stat columns).
export function formatValue(value, fieldMeta) {
  if (value == null) return '';
  const type = fieldMeta && fieldMeta.type;
  const unit = (fieldMeta && fieldMeta.unit) || '';
  let out;
  if (type && FORMATTERS[type]) {
    out = FORMATTERS[type](value);
  } else if (typeof value === 'number') {
    // Unknown numeric column (computed, zscore, factor_score, etc).
    out = Number.isInteger(value) ? int(value) : num(value);
  } else {
    out = str(value);
  }
  if (out === '') return out;
  // Prefix currency, suffix multiplier. Percent already carries its own %.
  if (unit === '$') return '$' + out;
  if (unit === 'x') return out + 'x';
  return out;
}

// Sign class for change-like numeric cells: 'sign-pos' | 'sign-neg' | ''.
// Only applies to pct fields and known change ids so we do not paint every
// number green/pink.
const SIGN_FIELD_IDS = new Set([
  'change', 'change_abs', 'change|1W', 'change|1M', 'gap',
  'premarket_change', 'postmarket_change', 'volume_change', 'factor_score',
]);
export function signClass(value, fieldMeta, fieldId) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  const type = fieldMeta && fieldMeta.type;
  const isSignField =
    type === 'pct' ||
    (fieldId && (SIGN_FIELD_IDS.has(fieldId) || /^zscore\(/.test(fieldId))) ||
    fieldId === 'factor_score';
  if (!isSignField) return '';
  if (value > 0) return 'sign-pos';
  if (value < 0) return 'sign-neg';
  return '';
}
