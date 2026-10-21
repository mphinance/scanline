// defaults.js - pure helpers for sensible starting values in the builders.

// Fields a fresh filter or factor row should start on: Price, then Change %.
export const PREFERRED_START_FIELDS = ['close', 'change'];

// Pick the first preferred field id that exists in `fields` and is not in
// `used`; otherwise the first field not in `used`; otherwise the first field.
// `fields` is an array of {id}. Returns '' when there are none.
export function pickDefaultField(fields, used = [], preferred = PREFERRED_START_FIELDS) {
  const list = Array.isArray(fields) ? fields : [];
  if (!list.length) return '';
  const taken = new Set(used);
  for (const id of preferred) {
    if (!taken.has(id) && list.some((f) => f && f.id === id)) return id;
  }
  const free = list.find((f) => f && !taken.has(f.id));
  return (free || list[0]).id;
}
