import React, { useState, useEffect } from 'react';
import ChartTerminal from './components/ChartTerminal';
import { createClient } from '@supabase/supabase-js';
import './App.css';

/* ═══════════════════════════════════════════════════════════
   NEXUS QUANT WEB — Bloomberg Terminal Dashboard
   Decoupled Frontend — connects to FastAPI backend via CORS
   ═══════════════════════════════════════════════════════════ */

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'http://placeholder.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ── Auth State ──
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // ── App State ──
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [assetClass, setAssetClass] = useState('stocks');
  const [ticker, setTicker] = useState('AAPL');
  const [interval, setInterval] = useState('5m');
  const [smaFast, setSmaFast] = useState(10);
  const [smaSlow, setSmaSlow] = useState(30);
  const [stopLoss, setStopLoss] = useState(2.0);
  const [takeProfit, setTakeProfit] = useState(4.0);
  const [capital, setCapital] = useState(10000);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isForex = assetClass === 'forex';

  // ── Auth Effects & Handlers ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      let error;
      if (authMode === 'login') {
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
      } else {
        ({ error } = await supabase.auth.signUp({ email, password }));
      }
      if (error) throw error;
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => await supabase.auth.signOut();

  const handleAssetClassChange = (v) => {
    setAssetClass(v);
    setResult(null);
    setError(null);
    setTicker(v === 'forex' ? 'EURUSD' : 'AAPL');
  };

  // ── Execute ──
  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        ticker: ticker.toUpperCase(),
        interval,
        sma_fast: smaFast,
        sma_slow: smaSlow,
        stop_loss_pct: stopLoss,
        take_profit_pct: takeProfit,
        capital,
        asset_class: assetClass,
      });
      const res = await fetch(`${API_BASE}/api/backtest?${params}`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Execution failed');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Chart configuration handled by ChartTerminal now ──

  const a = result?.account_state;

  // ── Auth Gate (Login/Register) ──
  if (!session) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="logo-wrap">
            <div className="logo">NQ</div>
          </div>
          <h2>NEXUS QUANT WEB</h2>
          <p className="auth-subtitle">Institutional Access Control</p>
          <form className="auth-form" onSubmit={handleAuth}>
            <div className="control-group">
              <label>Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="alias@node.io" />
            </div>
            <div className="control-group">
              <label>Passphrase</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {authError && <div className="error-bar"><span>⚠</span>{authError}</div>}
            <button className="btn-execute auth-btn" type="submit" disabled={authLoading}>
              {authLoading ? <span className="spinner" /> : (authMode === 'login' ? 'Authenticate' : 'Request Access')}
            </button>
          </form>
          <div className="auth-toggle">
            {authMode === 'login' ? "No account? " : "Already verified? "}
            <span onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(null); }}>
              {authMode === 'login' ? "Register Node" : "Authenticate"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Dashboard ──
  return (
    <div className="app">
      {/* ═══ SIDEBAR ═══ */}
      <div className="sidebar">
        <header className="sidebar-header">
          <div className="logo">NQ</div>
          <h1><span>NEXUS QUANT</span> WEB</h1>
        </header>

        {/* ═══ CONTROL PANEL ═══ */}
        <div className="control-panel">
          <div className="user-menu-container">
            <button
              className="user-badge"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <div className="user-avatar">{session.user.email[0].toUpperCase()}</div>
              <span className="user-email">{session.user.email.split('@')[0]}</span>
              <span className="dropdown-arrow">▼</span>
            </button>
            {menuOpen && (
              <div className="user-dropdown">
                <div className="dropdown-header">
                  <div className="dropdown-email">{session.user.email}</div>
                  <div className="dropdown-role">Trader (Verified)</div>
                </div>
                <div className="dropdown-body">
                  <button className="dropdown-item" onClick={() => { setMenuOpen(false); alert('Trade Ledger coming soon in Phase 8'); }}>
                    <span className="item-icon">📊</span> Trade Ledger
                  </button>
                  <button className="dropdown-item" onClick={() => setMenuOpen(false)}>
                    <span className="item-icon">⚙️</span> Settings
                  </button>
                </div>
                <div className="dropdown-footer">
                  <button className="dropdown-item signout" onClick={handleSignOut}>
                    <span className="item-icon">🚪</span> Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ ERROR ═══ */}
        {error && <div className="error-bar"><span>⚠</span>{error}</div>}
        <div className="control-group">
          <label>Asset</label>
          <select id="sel-asset" value={assetClass} onChange={e => handleAssetClassChange(e.target.value)}>
            <option value="stocks">Equities</option>
            <option value="forex">Forex</option>
          </select>
        </div>
        <div className="control-group">
          <label>{isForex ? 'Pair' : 'Ticker'}</label>
          <input id="inp-ticker" type="text" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder={isForex ? 'EURUSD' : 'AAPL'} />
        </div>
        <div className="control-group">
          <label>Timeframe</label>
          <select id="sel-tf" value={interval} onChange={e => setInterval(e.target.value)}>
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
          </select>
        </div>
        <div className="control-group">
          <label>SMA Fast</label>
          <input id="inp-sma-f" type="number" value={smaFast} onChange={e => setSmaFast(parseInt(e.target.value) || 5)} min="2" />
        </div>
        <div className="control-group">
          <label>SMA Slow</label>
          <input id="inp-sma-s" type="number" value={smaSlow} onChange={e => setSmaSlow(parseInt(e.target.value) || 20)} min="5" />
        </div>
        <div className="control-group">
          <label>Stop-Loss %</label>
          <input id="inp-sl" type="number" value={stopLoss} onChange={e => setStopLoss(parseFloat(e.target.value) || 1)} min="0.1" step="0.5" />
        </div>
        <div className="control-group">
          <label>Take-Profit %</label>
          <input id="inp-tp" type="number" value={takeProfit} onChange={e => setTakeProfit(parseFloat(e.target.value) || 2)} min="0.1" step="0.5" />
        </div>
        <div className="control-group">
          <label>Capital</label>
          <input id="inp-cap" type="number" value={capital} onChange={e => setCapital(parseFloat(e.target.value) || 1000)} min="100" step="1000" />
        </div>
        <button id="btn-exec" className="btn-execute" onClick={handleExecute} disabled={loading}>
          {loading && <span className="spinner" />}
          {loading ? 'Running...' : '▶ Execute Backtest'}
        </button>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="main-content">
        <div className="top-bar">
          <div className="header-right">
            <div className="status-indicator">
              <span className="status-dot" />
              System Online
            </div>
          </div>
        </div>

        {/* ═══ KPI MATRIX ═══ */}
        <div className="kpi-row">
          <div className="kpi-card gold">
            <div className="kpi-label">Final Capital</div>
            <div className="kpi-value gold">
              ${a ? a.net_equity.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
            </div>
            <div className="kpi-sub">{a ? `from $${a.starting_capital.toLocaleString()}` : 'Awaiting backtest'}</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-label">Bot Return</div>
            <div className={`kpi-value ${a && a.total_return_pct >= 0 ? 'green' : 'red'}`}>
              {a ? `${a.total_return_pct >= 0 ? '+' : ''}${a.total_return_pct}%` : '—'}
            </div>
            <div className="kpi-sub">{a ? `${a.total_trades} trades` : '0 trades'}</div>
          </div>
          <div className="kpi-card red">
            <div className="kpi-label">Max Drawdown</div>
            <div className="kpi-value red">
              {a ? `${a.max_drawdown_pct.toFixed(2)}%` : '—'}
            </div>
            <div className="kpi-sub">Peak-to-trough</div>
          </div>
          <div className="kpi-card blue">
            <div className="kpi-label">Win Rate</div>
            <div className={`kpi-value ${a && a.win_rate >= 50 ? 'green' : 'red'}`}>
              {a ? `${a.win_rate.toFixed(1)}%` : '—'}
            </div>
            <div className="kpi-sub">{a ? `Sharpe ${a.sharpe_ratio.toFixed(2)}` : 'N/A'}</div>
          </div>
        </div>

        {/* ═══ WORKSPACE ═══ */}
        <div className="workspace">
          {/* CHART (70%) */}
          <div className={`panel ${isFullscreen ? 'chart-fullscreen' : ''}`}>
            <div className="chart-container">
              {result ? (
                <ChartTerminal
                  data={result}
                  isForex={isForex}
                  isFullscreen={isFullscreen}
                  toggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                />
              ) : (
                <div className="empty-state" style={{ minHeight: '400px' }}>
                  <div className="icon">📈</div>
                  <h4>No Data</h4>
                  <p>Execute a backtest to render the Deep Analysis terminal.</p>
                </div>
              )}
            </div>
          </div>

          {/* ORDER BOOK (30%) */}
          <div className="panel">
            <div className="panel-header">
              <h3>Order Book</h3>
              {result?.trades && <span className="panel-badge green">{result.trades.length} fills</span>}
            </div>
            <div className="ledger-wrap">
              {result?.trades?.length > 0 ? (
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Price</th>
                      <th>P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => {
                      const cls = (t.type.includes('BUY') || t.type.includes('COVER')) ? 'long' : 'short';
                      const pd = result.price_decimals || 2;
                      return (
                        <tr key={i}>
                          <td>{new Date(t.date).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          <td><span className={`tag ${cls}`}>{t.type.replace(' (CLOSE)', '')}</span></td>
                          <td>{result.asset_class === 'forex' ? '' : '$'}{t.price.toFixed(pd)}</td>
                          <td className={t.pnl > 0 ? 'pnl-pos' : t.pnl < 0 ? 'pnl-neg' : ''}>
                            {t.pnl !== 0 ? `${t.pnl > 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">
                  <div className="icon">📋</div>
                  <h4>Empty</h4>
                  <p>Run a backtest to fill the order book.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
