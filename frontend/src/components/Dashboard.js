import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChartTerminal from './ChartTerminal';

const Card = ({ title, badge, children, className = '' }) => {
  return (
    <div className={`rounded-2xl border border-neutral-800 bg-space-900/80 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${className}`}>
      {title ? (
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/70">
          <div className="text-[11px] tracking-[0.26em] text-neutral-400">{title}</div>
          {badge ? (
            <div className="text-[10px] font-mono tracking-widest px-2.5 py-1 rounded-lg border border-neutral-800 bg-space-950/50 text-neutral-300">
              {badge}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </div>
  );
};

const Metric = ({ label, value, sub, tone = 'neutral' }) => {
  const toneMap = {
    neutral: 'text-neutral-100',
    green: 'text-neon-green',
    red: 'text-red-400',
    yellow: 'text-neon-yellow',
  };
  return (
    <div className="rounded-2xl border border-neutral-800 bg-space-900/70 backdrop-blur-xl px-5 py-4">
      <div className="text-[11px] tracking-[0.26em] text-neutral-400">{label}</div>
      <div className={`mt-2 font-mono text-xl ${toneMap[tone] || toneMap.neutral}`}>{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </div>
  );
};

export default function Dashboard({
  session,
  onSignOut,
  assetClass,
  setAssetClass,
  ticker,
  setTicker,
  interval,
  setInterval,
  smaFast,
  setSmaFast,
  smaSlow,
  setSmaSlow,
  stopLoss,
  setStopLoss,
  takeProfit,
  setTakeProfit,
  capital,
  setCapital,
  loading,
  error,
  result,
  isForex,
  handleExecute,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const a = result?.account_state;
  const decimals = result?.price_decimals || (isForex ? 5 : 2);

  const metrics = useMemo(() => {
    const net = a?.net_equity;
    const ret = a?.total_return_pct;
    const win = a?.win_rate;
    const dd = a?.max_drawdown_pct;
    return {
      capital: net != null ? `$${Number(net).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—',
      ret: ret != null ? `${ret >= 0 ? '+' : ''}${ret}%` : '—',
      win: win != null ? `${Number(win).toFixed(1)}%` : '—',
      dd: dd != null ? `${Number(dd).toFixed(2)}%` : '—',
      trades: a?.total_trades != null ? `${a.total_trades} trades` : 'Awaiting backtest',
      sharpe: a?.sharpe_ratio != null ? `Sharpe ${Number(a.sharpe_ratio).toFixed(2)}` : 'N/A',
      from: a?.starting_capital != null ? `from $${Number(a.starting_capital).toLocaleString()}` : 'Awaiting backtest',
    };
  }, [a]);

  return (
    <div className="min-h-full bg-space-950 text-neutral-100 font-ui">
      <div className="px-6 py-5 border-b border-neutral-800 bg-space-950/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-neon-yellow to-neon-green grid place-items-center text-space-950 font-bold">
              NQ
            </div>
            <div>
              <div className="text-[11px] tracking-[0.28em] text-neutral-400">NEXUS QUANT</div>
              <div className="text-sm font-semibold text-neutral-100">Cyber‑Institutional Terminal</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 rounded-xl border border-neutral-800 bg-space-900/60 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-neon-green shadow-[0_0_16px_rgba(0,255,163,0.6)]" />
              <span className="text-[11px] tracking-widest text-neutral-300">SYSTEM ONLINE</span>
            </div>

            <div className="hidden md:block text-[11px] font-mono text-neutral-400">
              {session?.user?.email ? session.user.email.split('@')[0].toUpperCase() : 'TRADER'}
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="rounded-xl border border-neutral-800 bg-space-900/60 px-3 py-2 text-[11px] tracking-widest text-neutral-300 hover:text-neutral-100 hover:border-neutral-700 transition-all"
            >
              DISCONNECT
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="grid grid-cols-12 gap-5"
        >
          <div className="col-span-12 grid grid-cols-12 gap-5">
            <div className="col-span-12 md:col-span-3">
              <Metric label="CURRENT CAPITAL" value={metrics.capital} sub={metrics.from} tone="yellow" />
            </div>
            <div className="col-span-12 md:col-span-3">
              <Metric
                label="TOTAL RETURN"
                value={metrics.ret}
                sub={metrics.trades}
                tone={a && a.total_return_pct >= 0 ? 'green' : a ? 'red' : 'neutral'}
              />
            </div>
            <div className="col-span-12 md:col-span-3">
              <Metric label="WIN RATE" value={metrics.win} sub={metrics.sharpe} tone={a && a.win_rate >= 50 ? 'green' : a ? 'red' : 'neutral'} />
            </div>
            <div className="col-span-12 md:col-span-3">
              <Metric label="MAX DRAWDOWN" value={metrics.dd} sub="Peak-to-trough" tone="red" />
            </div>
          </div>

          <div className="col-span-12 lg:col-span-3">
            <Card title="CONTROL PANEL" badge={assetClass.toUpperCase()}>
              {error ? (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              <div className="space-y-4">
                <div>
                  <div className="text-[11px] tracking-widest text-neutral-400">ASSET</div>
                  <select
                    value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                  >
                    <option value="stocks">Equities</option>
                    <option value="forex">Forex</option>
                  </select>
                </div>

                <div>
                  <div className="text-[11px] tracking-widest text-neutral-400">{isForex ? 'PAIR' : 'TICKER'}</div>
                  <input
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    placeholder={isForex ? 'EURUSD' : 'AAPL'}
                    className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 placeholder:text-neutral-600 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                  />
                </div>

                <div>
                  <div className="text-[11px] tracking-widest text-neutral-400">TIMEFRAME</div>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                  >
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] tracking-widest text-neutral-400">SMA FAST</div>
                    <input
                      type="number"
                      min="2"
                      value={smaFast}
                      onChange={(e) => setSmaFast(parseInt(e.target.value, 10) || 5)}
                      className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] tracking-widest text-neutral-400">SMA SLOW</div>
                    <input
                      type="number"
                      min="5"
                      value={smaSlow}
                      onChange={(e) => setSmaSlow(parseInt(e.target.value, 10) || 20)}
                      className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] tracking-widest text-neutral-400">STOP‑LOSS %</div>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                      className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] tracking-widest text-neutral-400">TAKE‑PROFIT %</div>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                      className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] tracking-widest text-neutral-400">CAPITAL</div>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={capital}
                    onChange={(e) => setCapital(parseFloat(e.target.value) || 1000)}
                    className="mt-2 w-full rounded-xl bg-space-950/60 border border-neutral-800 px-3 py-3 text-sm font-mono text-neutral-100 outline-none transition-all focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.99 }}
                  type="button"
                  onClick={handleExecute}
                  disabled={loading}
                  className="w-full rounded-xl bg-neon-green text-space-950 font-semibold py-3 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_0_0_1px_rgba(0,255,163,0.25),0_18px_50px_rgba(0,0,0,0.55)] hover:shadow-[0_0_0_1px_rgba(0,255,163,0.35),0_22px_70px_rgba(0,0,0,0.65)]"
                >
                  {loading ? 'Running…' : 'EXECUTE BACKTEST'}
                </motion.button>
              </div>
            </Card>
          </div>

          <div className={`col-span-12 lg:col-span-7 ${isFullscreen ? 'lg:col-span-12' : ''}`}>
            <Card title="MARKET STRUCTURE" badge={result ? `${result.ticker} · ${result.interval}` : 'NO DATA'} className={isFullscreen ? 'fixed inset-4 z-50' : ''}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] font-mono text-neutral-500">
                  {result ? `${result.asset_class.toUpperCase()} · ${result.rendered_candles}/${result.total_candles}` : 'Awaiting backtest…'}
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="rounded-xl border border-neutral-800 bg-space-950/40 px-3 py-2 text-[11px] tracking-widest text-neutral-300 hover:text-neutral-100 hover:border-neutral-700 transition-all"
                >
                  {isFullscreen ? 'EXIT FULL' : 'FULL SCREEN'}
                </button>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-black/20 overflow-hidden">
                {result ? (
                  <div style={{ height: isFullscreen ? 'calc(100vh - 160px)' : 520 }}>
                    <ChartTerminal
                      data={result}
                      isForex={isForex}
                      isFullscreen={false}
                      toggleFullscreen={() => {}}
                    />
                  </div>
                ) : (
                  <div className="h-[520px] grid place-items-center text-neutral-500">
                    <div className="text-center">
                      <div className="text-neon-yellow font-mono tracking-widest text-[11px]">NO SIGNALS</div>
                      <div className="mt-2 text-neutral-200 font-semibold">Run a backtest to render the terminal</div>
                      <div className="mt-1 text-sm text-neutral-500">Candles, indicators, drawings, and volume will appear here.</div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className={`col-span-12 lg:col-span-2 ${isFullscreen ? 'hidden' : ''}`}>
            <Card title="EXECUTION LOG" badge={result?.trades ? `${result.trades.length} FILLS` : '0 FILLS'}>
              <div className="max-h-[610px] overflow-auto">
                {result?.trades?.length > 0 ? (
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-space-900/90 backdrop-blur-xl">
                      <tr>
                        <th className="py-2 text-[10px] tracking-widest text-neutral-500">TIME</th>
                        <th className="py-2 text-[10px] tracking-widest text-neutral-500">SIDE</th>
                        <th className="py-2 text-[10px] tracking-widest text-neutral-500">PX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice().reverse().map((t, i) => {
                        const side = (t.type.includes('BUY') || t.type.includes('COVER')) ? 'BUY' : 'SELL';
                        const sideTone = side === 'BUY' ? 'text-neon-green' : 'text-red-400';
                        const timeStr = new Date(t.date).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        return (
                          <tr key={i} className="border-t border-neutral-800/60 hover:bg-white/5 transition-colors">
                            <td className="py-2 pr-2 font-mono text-[11px] text-neutral-400">{timeStr}</td>
                            <td className={`py-2 pr-2 font-mono text-[11px] ${sideTone}`}>{side}</td>
                            <td className="py-2 font-mono text-[11px] text-neutral-200">
                              {result.asset_class === 'forex' ? '' : '$'}{Number(t.price).toFixed(decimals)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-10 text-center">
                    <div className="text-neon-yellow font-mono tracking-widest text-[11px]">EMPTY</div>
                    <div className="mt-2 text-sm text-neutral-500">Trade executions will stream here.</div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </motion.div>

        <AnimatePresence>
          {isFullscreen ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setIsFullscreen(false)}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

