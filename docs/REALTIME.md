# Real-time mode

By default TradingView serves the screener delayed data. If your TradingView
account has real-time entitlements, Scanline can send your session cookie so
the same scanner endpoint returns real-time quotes for the feeds you pay for.
Without the cookie nothing changes.

## What the cookie is

The `sessionid` cookie is a **login credential**. Anyone holding it can act as
your TradingView account until it is revoked. Treat it like a password: do not
paste it into chats, issues, screenshots or shell history you share, and do not
commit it.

What it grants Scanline: sending authenticated requests to TradingView's
scanner so entitled symbols come back real-time. Scanline is read-only and
never places orders, but the cookie itself is not scoped. TradingView sees the
request as you.

## Get the cookie

1. Log in at tradingview.com in your browser.
2. Open developer tools, then Application (Chrome) or Storage (Firefox),
   then Cookies, then `https://www.tradingview.com`.
3. Copy the value of `sessionid`. If you also see `sessionid_sign`, copy that
   too (optional, but newer accounts use it).

## Give it to Scanline

Either set environment variables before starting the server:

```bash
export SCANLINE_TV_SESSIONID='...'
export SCANLINE_TV_SESSIONID_SIGN='...'   # optional
python run.py
```

or store it from the machine running Scanline:

```bash
curl -X POST http://127.0.0.1:8000/api/settings/cookie \
  -H 'Content-Type: application/json' \
  -d '{"sessionid": "...", "sessionid_sign": "..."}'
```

The environment wins if both are set. The POST and DELETE endpoints refuse any
client that is not on loopback, any request carrying proxy forwarding headers,
and any cross-origin browser request, so a website cannot set or clear it.

## Where it is stored

Only when you use the endpoint: `$XDG_CONFIG_HOME/scanline/tv_cookie.json`
(default `~/.config/scanline/tv_cookie.json`), written atomically with mode
`0600`. Environment variables are not copied anywhere. In Docker, pass the
variables through the compose environment; the endpoint is not reachable from
the host there because requests arrive from the bridge address.

## Check the mode

`GET /api/settings/cookie` returns only `{"configured": bool, "mode": "..."}`.
`GET /api/health` and every screen response (`meta.mode`) report the same mode:

- `delayed`: no cookie.
- `realtime`: a cookie is being sent.
- `cookie_rejected`: TradingView answered 401 or 403 to the cookie. Scanline
  retried without it and keeps using delayed data for 10 minutes before trying
  the cookie again. Setting a new cookie resets this immediately. An expired
  cookie may also simply yield delayed data with a normal 200, which cannot be
  detected, so verify real-time against a symbol you are entitled to.

## Revoke it

- Stop using it here: `curl -X DELETE http://127.0.0.1:8000/api/settings/cookie`
  removes the file. Unset the environment variables for an env-provided cookie.
- Kill it for good: **log out of TradingView** (or sign out of all sessions in
  your account settings). That invalidates the `sessionid` everywhere, including
  anything that copied it.

## What Scanline guarantees

The cookie value never appears in a response body, log line, exception message
or cache key. The cache key includes only the mode, so delayed and real-time
results are never served for one another. Upstream errors are reduced to a
short message and a code before they leave the process.
