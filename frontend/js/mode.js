// mode.js - the data-mode badge in the footer, driven by GET /api/health.
// `mode` is "delayed" | "realtime" | "cookie_rejected". Missing or unknown
// values fall back to "delayed".

export const REALTIME_DOC_URL = 'https://github.com/mphinance/scanline/blob/master/docs/REALTIME.md';

const MODES = {
  delayed: {
    label: 'DELAYED DATA',
    tone: 'delayed',
    title: 'Quotes are delayed. Real-time data needs a TradingView session cookie. Click for setup steps.',
  },
  realtime: {
    label: 'REAL-TIME',
    tone: 'realtime',
    title: 'Real-time data is on, using your TradingView session cookie. Click for details.',
  },
  cookie_rejected: {
    label: 'COOKIE REJECTED',
    tone: 'rejected',
    title: 'TradingView rejected the session cookie, so quotes are delayed. Real-time needs a fresh cookie. Click for setup steps.',
  },
};

export function modeInfo(mode) {
  const key = typeof mode === 'string' && Object.prototype.hasOwnProperty.call(MODES, mode) ? mode : 'delayed';
  return { mode: key, url: REALTIME_DOC_URL, ...MODES[key] };
}

export function renderModeBadge(mode) {
  const host = document.getElementById('mode-badge');
  if (!host) return;
  const info = modeInfo(mode);
  host.textContent = info.label;
  host.title = info.title;
  host.href = info.url;
  host.dataset.mode = info.mode;
  host.className = 'mode-badge mode-' + info.tone;
}
