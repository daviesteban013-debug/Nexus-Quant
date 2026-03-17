import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

/* ═══════════════════════════════════════════════════════════
   NEXUS QUANT WEB — Bloomberg Terminal Dashboard
   Decoupled Frontend — connects to FastAPI backend via CORS
   ═══════════════════════════════════════════════════════════ */

// If API URL is provided via ENV (mostly local dev), use it. 
// Otherwise, detect if we are on the web (e.g. Render) and use the exact same domain.
const getApiBase = () => {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return window.location.origin; // Same domain as the React app itself
  }
  return 'http://localhost:8000'; // Fallback for local dev
};

const API_BASE = getApiBase();
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'http://placeholder.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ── Auth State ──
  const [session, setSession] = useState(null);

  // ── App State ──
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

  const handleSignOut = async () => await supabase.auth.signOut();

  const handleAssetClassChange = (v) => {
    setAssetClass(v);
    setResult(null);
    setError(null);
    setTicker(v === 'forex' ? 'EURUSD' : (v === 'indices' ? 'S&P 500' : 'AAPL'));
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

  // ── Auth Gate (Login/Register) ──
  if (!session) {
    return <Login supabase={supabase} />;
  }

  // ── Main Dashboard ──
  return (
    <Dashboard
      session={session}
      onSignOut={handleSignOut}
      assetClass={assetClass}
      setAssetClass={handleAssetClassChange}
      ticker={ticker}
      setTicker={setTicker}
      interval={interval}
      setInterval={setInterval}
      smaFast={smaFast}
      setSmaFast={setSmaFast}
      smaSlow={smaSlow}
      setSmaSlow={setSmaSlow}
      stopLoss={stopLoss}
      setStopLoss={setStopLoss}
      takeProfit={takeProfit}
      setTakeProfit={setTakeProfit}
      capital={capital}
      setCapital={setCapital}
      loading={loading}
      error={error}
      result={result}
      isForex={isForex}
      handleExecute={handleExecute}
    />
  );
}

export default App;
