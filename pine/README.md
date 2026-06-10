# Pine: indicators meant for AI

Pine Script that pairs with the screener and its MCP server. The theme here is
TradingView, AI'ed: indicators that do not just draw for a human eye, they print
a read a model can consume.

## neon_ai_read.pine

`NEON AI READ` is the on-chart twin of the MCP `analyze` tool. It prints a
high-contrast dashboard plus a single machine-parseable line so that when you
screenshot a TradingView chart and hand it to an AI (or to our `chart` /
`analyze` MCP tools), the model reads the state off the labels instead of
guessing from pixels.

It speaks the exact same vocabulary as the screener's signals and the `analyze`
tool: the Fibonacci EMA stack (8/21/34/55/89), the golden-cross stack, RSI /
MACD / Stochastic momentum, ADX trend strength, 52-week position, and a
composite rating mapped with the same bands (Strong Buy ... Strong Sell).

The bottom-right box is the point, one delimited string:

```
AI|trend=UP;rsi=46.4;macd=BEAR;adx=19.0;stack=GOLDEN;pos52=70.4%;rvol=0.96;rating=NEUTRAL
```

### Use it

1. On TradingView, open Pine Editor, paste `neon_ai_read.pine`, Add to chart.
2. Set two alerts if you want: the aligned-pullback "AI BUY" and the rating flip.
3. Screenshot the chart and feed it to your agent, or ask the agent for the same
   read live with the `analyze` MCP tool. The on-chart read and the MCP read use
   the same logic, so they agree.

Pine v6. Synthwave palette to match NEON SCREENER.
