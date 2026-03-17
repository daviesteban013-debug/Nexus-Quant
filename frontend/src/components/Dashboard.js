import React, { useMemo, useState } from 'react';
import ChartTerminal from './ChartTerminal';

const INDEX_OPTIONS = ['S&P 500', 'NASDAQ 100', 'Dow Jones', 'Russell 2000'];

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
  const isIndices = assetClass === 'indices';
  const isFx = assetClass === 'forex';

  const header = useMemo(() => {
    const user = session?.user?.email ? session.user.email.split('@')[0].toUpperCase() : 'TRADER';
    const sym = String(ticker || '').toUpperCase();
    return { user, sym };
  }, [session?.user?.email, ticker]);

  const stats = useMemo(() => {
    const net = a?.net_equity;
    const ret = a?.total_return_pct;
    const trades = a?.total_trades;
    const ai = result?.ai_prediction?.confidence_score;
    return {
      net: net != null ? String(net) : '—',
      ret: ret != null ? `${ret >= 0 ? '+' : ''}${ret}%` : '—',
      trades: trades != null ? String(trades) : '—',
      ai: typeof ai === 'number' ? `${Math.round(ai * 100)}%` : '—',
    };
  }, [a, result?.ai_prediction?.confidence_score]);

  return (
    <div className="min-h-full bg-black text-[#00FFA3] font-mono">
      <div className="px-4 py-3 border-b border-white/10 sticky top-0 bg-black z-30">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] tracking-widest">
            NEXUS QUANT | {header.user} | NET {stats.net} | RET {stats.ret} | TRADES {stats.trades} | AI {stats.ai}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="px-2 py-1 border border-white/10 text-[11px] tracking-widest hover:border-white/20"
          >
            EXIT
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-12 gap-4">
        <div className={`col-span-12 lg:col-span-3 ${isFullscreen ? 'hidden' : ''}`}>
          <div className="border border-white/10 p-3">
            {error ? (
              <div className="mb-3 border border-[#FF3B30] text-[#FF3B30] p-2 text-[11px] tracking-widest">
                {error}
              </div>
            ) : null}

            <div className="space-y-3 text-[11px] tracking-widest">
              <div>
                <div className="opacity-70">ASSET</div>
                <select
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value)}
                  className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                >
                  <option value="stocks">EQUITIES</option>
                  <option value="forex">FOREX</option>
                  <option value="indices">INDICES</option>
                </select>
              </div>

              <div>
                <div className="opacity-70">{isIndices ? 'INDEX' : isFx ? 'PAIR' : 'TICKER'}</div>
                {isIndices ? (
                  <select
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  >
                    {INDEX_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt.toUpperCase()}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    placeholder={isFx ? 'EURUSD' : 'AAPL'}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  />
                )}
              </div>

              <div>
                <div className="opacity-70">TIMEFRAME</div>
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="opacity-70">SMA_FAST</div>
                  <input
                    type="number"
                    min="2"
                    value={smaFast}
                    onChange={(e) => setSmaFast(parseInt(e.target.value, 10) || 5)}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  />
                </div>
                <div>
                  <div className="opacity-70">SMA_SLOW</div>
                  <input
                    type="number"
                    min="5"
                    value={smaSlow}
                    onChange={(e) => setSmaSlow(parseInt(e.target.value, 10) || 20)}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="opacity-70">SL%</div>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  />
                </div>
                <div>
                  <div className="opacity-70">TP%</div>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="opacity-70">CAPITAL</div>
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={capital}
                  onChange={(e) => setCapital(parseFloat(e.target.value) || 1000)}
                  className="mt-1 w-full bg-black border border-white/10 px-2 py-2 text-[#00FFA3] outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleExecute}
                disabled={loading}
                className="w-full px-3 py-2 border border-white/10 text-[11px] tracking-widest hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'RUNNING' : 'RUN'}
              </button>
            </div>
          </div>
        </div>

        <div className={`col-span-12 ${isFullscreen ? 'lg:col-span-12' : 'lg:col-span-9'}`}>
          <div className={`${isFullscreen ? 'fixed inset-0 z-50 p-4 bg-black' : ''}`}>
            <div className="border border-white/10">
              {result ? (
                <ChartTerminal
                  data={result}
                  isForex={isForex}
                  isFullscreen={isFullscreen}
                  toggleFullscreen={() => setIsFullscreen((v) => !v)}
                />
              ) : (
                <div className="h-[520px] grid place-items-center text-[11px] tracking-widest opacity-70">
                  RUN BACKTEST
                </div>
              )}
            </div>
          </div>
        </div>

        {!isFullscreen ? (
          <div className="col-span-12">
            <div className="border border-white/10 p-3">
              <div className="text-[11px] tracking-widest opacity-70 mb-2">EXECUTION LOG</div>
              {result?.trades?.length ? (
                <div className="max-h-[220px] overflow-auto">
                  <table className="w-full text-left text-[11px] tracking-widest">
                    <thead className="sticky top-0 bg-black">
                      <tr className="border-b border-white/10">
                        <th className="py-2 pr-2 opacity-70">TIME</th>
                        <th className="py-2 pr-2 opacity-70">SIDE</th>
                        <th className="py-2 opacity-70">PX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice().reverse().map((t, i) => {
                        const side = (String(t.type || '').includes('BUY') || String(t.type || '').includes('COVER')) ? 'BUY' : 'SELL';
                        const tone = side === 'BUY' ? 'text-[#00FFA3]' : 'text-[#FF3B30]';
                        const timeStr = new Date(t.date).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        return (
                          <tr key={i} className="border-t border-white/10">
                            <td className="py-2 pr-2 opacity-80">{timeStr}</td>
                            <td className={`py-2 pr-2 ${tone}`}>{side}</td>
                            <td className="py-2 opacity-80">{String(t.price)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[11px] tracking-widest opacity-70">EMPTY</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

