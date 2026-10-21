// firstrun.js - one dismissible "where do I start" strip, remembered in
// localStorage. The storage logic is pure so it can be tested headlessly.

export const FIRSTRUN_KEY = 'scanline.firstRunDismissed';

// `storage` is anything with getItem/setItem (localStorage in the browser).
// Any storage failure means "show it", never an exception.
export function shouldShowFirstRun(storage) {
  try {
    return storage.getItem(FIRSTRUN_KEY) !== '1';
  } catch (err) {
    return true;
  }
}

export function dismissFirstRun(storage) {
  try {
    storage.setItem(FIRSTRUN_KEY, '1');
  } catch (err) {
    // Private mode or blocked storage: the strip simply returns next visit.
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return { getItem: () => null, setItem: () => {} };
  }
}

function mount() {
  const storage = browserStorage();
  if (!shouldShowFirstRun(storage)) return;
  const anchor = document.getElementById('toolbar');
  if (!anchor || document.getElementById('first-run')) return;

  const strip = document.createElement('div');
  strip.id = 'first-run';
  strip.setAttribute('role', 'note');

  const text = document.createElement('span');
  text.className = 'first-run-text';
  text.append('Pick a preset, or press ');
  const kbd = document.createElement('kbd');
  kbd.textContent = 'Ctrl-K';
  text.append(kbd);
  text.append(' to search scans, fields, and tickers.');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-ghost first-run-close';
  close.textContent = 'Got it';
  close.setAttribute('aria-label', 'Dismiss this tip');
  close.addEventListener('click', () => {
    dismissFirstRun(storage);
    strip.remove();
  });

  strip.append(text, close);
  anchor.after(strip);
}

if (typeof window !== 'undefined' && window.Screener) {
  window.Screener.registerModule('firstrun', mount);
}
