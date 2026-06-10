# SCANLINE showcase (GitHub Pages)

The client-side half of the project: a static, no-backend showcase of what you
can build on TradingView. It is the live demo you can host on GitHub Pages, the
counterpart to the screener app you run at home.

It makes the case in three tiers, all TradingView, no outside data:

1. **Widgets** - a gallery of official TradingView embeds (Advanced Chart,
   Symbol Overview, Technical gauge, Market Overview, Stock and Crypto heatmaps,
   Screener, Economic Calendar, Top Stories). Zero setup, TradingView hosts them.
2. **Lightweight Charts** - TradingView's open-source charting core (Apache 2.0),
   loaded from a CDN and fed data in the page. The real "build your own" tier.
3. **The AI / MCP layer** - how the screener's MCP server lets an agent screen,
   compare, rank, and read a chart across every timeframe at once.

## Run it locally

It is plain static files, so anything that serves a directory works:

```bash
cd showcase
python -m http.server 5500
# open http://127.0.0.1:5500/
```

## Publish on GitHub Pages

A workflow at `.github/workflows/pages.yml` deploys this folder. One-time setup:

1. Repo Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. Push to `master` (or run the workflow manually).

It goes live at `https://mphinance.github.io/scanline/`.

## Files

```
index.html   landing + widget gallery + Lightweight Charts panel + MCP section
styles.css   synthwave theme, self-contained (mirrors the app's tokens)
app.js       Lightweight Charts demo (candles / line / area)
```

Charts and data are by TradingView. This is an independent showcase, not
affiliated with or endorsed by TradingView.
