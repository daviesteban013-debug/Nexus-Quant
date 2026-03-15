import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import '../App.css';
import { DrawingsProvider } from './drawings/DrawingsContext';
import DrawingToolbar from './drawings/DrawingToolbar';
import DrawingOverlayCanvas from './drawings/DrawingOverlayCanvas';

function toneForDelta(delta, intensity) {
  const isNeutral = Math.abs(delta) < 1;
  if (isNeutral) {
    return { body: '#FFD700', wick: '#FFD700', border: '#FFD700' };
  }
  const high = intensity >= 0.75;
  if (delta > 0) {
    return high
      ? { body: '#00FFA3', wick: '#00FFA3', border: '#00FFA3' }
      : { body: '#0B3D2E', wick: '#0B3D2E', border: '#0B3D2E' };
  }
  return high
    ? { body: '#FF3B30', wick: '#FF3B30', border: '#FF3B30' }
    : { body: '#3D0B0E', wick: '#3D0B0E', border: '#3D0B0E' };
}

function fmt(n, d) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toFixed(d);
}

function AdvancedProChart({ data, isForex, isFullscreen, onToggleFullscreen }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const fastSeriesRef = useRef(null);
  const slowSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const legendRef = useRef(null);
  const roRef = useRef(null);
  const fibLinesRef = useRef([]);
  const liveLineRef = useRef(null);
  const candleMetaRef = useRef(new Map());
  const didFitRef = useRef(false);
  const fitKeyRef = useRef('');
  const decimalsRef = useRef(2);
  const aiRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState('standard');
  const [showFibs, setShowFibs] = useState(false);

  const decimals = useMemo(() => {
    const pd = data?.price_decimals;
    if (typeof pd === 'number') return pd;
    return isForex ? 5 : 2;
  }, [data?.price_decimals, isForex]);

  const aiConfidence = useMemo(() => {
    const cs = data?.ai_prediction?.confidence_score;
    return typeof cs === 'number' ? cs : null;
  }, [data?.ai_prediction?.confidence_score]);

  useEffect(() => {
    decimalsRef.current = decimals;
  }, [decimals]);

  useEffect(() => {
    aiRef.current = aiConfidence;
  }, [aiConfidence]);

  const {
    candleStandard,
    candleDelta,
    volumeHist,
    markers,
    fibLevels,
    watermarkText,
    metaMap,
  } = useMemo(() => {
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    if (candles.length === 0) {
      return {
        candleStandard: [],
        candleDelta: [],
        volumeHist: [],
        markers: [],
        fibLevels: [],
        watermarkText: '',
        metaMap: new Map(),
      };
    }

    const std = [];
    const del = [];
    const vol = [];
    const meta = new Map();

    let maxHigh = -Infinity;
    let minLow = Infinity;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const t = new Date(c.x).getTime() / 1000;
      const o = Number(c.o);
      const h = Number(c.h);
      const l = Number(c.l);
      const cl = Number(c.c);
      const v = Number(c.total_volume ?? c.v ?? 0);
      const delta = Number(c.volume_delta ?? ((c.buy_volume ?? 0) - (c.sell_volume ?? 0)));
      const intensity = typeof c.volume_intensity === 'number' ? c.volume_intensity : 0;

      if (Number.isFinite(h) && h > maxHigh) maxHigh = h;
      if (Number.isFinite(l) && l < minLow) minLow = l;

      std.push({ time: t, open: o, high: h, low: l, close: cl });

      const tone = toneForDelta(delta, intensity);
      del.push({
        time: t,
        open: o,
        high: h,
        low: l,
        close: cl,
        color: tone.body,
        borderColor: tone.border,
        wickColor: tone.wick,
      });

      vol.push({
        time: t,
        value: v,
        color: cl > o ? 'rgba(0, 255, 163, 0.20)' : 'rgba(255, 59, 48, 0.20)',
      });

      meta.set(t, { o, h, l, c: cl, v, delta, intensity });
    }

    const trades = Array.isArray(data?.trades) ? data.trades : [];
    const m = trades.map((t) => {
      const isBuy = String(t.type || '').includes('BUY') || String(t.type || '').includes('COVER');
      const side = isBuy ? 'BUY' : 'SELL';
      const px = Number(t.price);
      const pnl = typeof t.pnl === 'number' ? t.pnl : null;
      const pxLabel = Number.isFinite(px) ? `${isForex ? '' : '$'}${px.toFixed(isForex ? 5 : 2)}` : '';
      const pnlLabel = pnl != null ? ` P/L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '';
      return {
        time: new Date(t.date).getTime() / 1000,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#00FFA3' : '#FF3B30',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${side} ${pxLabel}${pnlLabel}`.trim(),
      };
    });

    let fibs = [];
    if (maxHigh > -Infinity && minLow < Infinity && maxHigh > minLow) {
      const diff = maxHigh - minLow;
      const ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
      fibs = ratios.map((r) => ({
        price: maxHigh - (diff * r),
        title: `Fib ${r.toFixed(3)}`,
        color: 'rgba(255, 215, 0, 0.28)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      }));
    }

    const wt = `${String(data?.ticker || '').replace('=X', '')} ${String(data?.interval || '')}`.trim();

    return {
      candleStandard: std,
      candleDelta: del,
      volumeHist: vol,
      markers: m,
      fibLevels: fibs,
      watermarkText: wt,
      metaMap: meta,
    };
  }, [data, isForex]);

  useEffect(() => {
    candleMetaRef.current = metaMap;
  }, [metaMap]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const chart = createChart(host, {
      width: Math.max(1, Math.floor(host.clientWidth)),
      height: Math.max(1, Math.floor(host.clientHeight)),
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#a1a1aa',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#2A2E39', style: 1 },
        horzLines: { color: '#2A2E39', style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#FFD700', style: 3, labelBackgroundColor: '#18181b' },
        horzLine: { color: '#FFD700', style: 3, labelBackgroundColor: '#18181b' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
        alignLabels: true,
      },
      watermark: {
        visible: true,
        fontSize: 48,
        horzAlign: 'center',
        vertAlign: 'center',
        color: 'rgba(255, 255, 255, 0.06)',
        text: '',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: isForex ? 5 : 2,
        minMove: isForex ? 0.00001 : 0.01,
      },
    });

    const fast = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const slow = chart.addSeries(LineSeries, {
      color: '#FFD700',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    fastSeriesRef.current = fast;
    slowSeriesRef.current = slow;
    volumeSeriesRef.current = volume;
    didFitRef.current = false;
    fitKeyRef.current = '';

    const onCrosshair = (param) => {
      const el = legendRef.current;
      if (!el) return;
      const t = typeof param?.time === 'number' ? param.time : null;
      if (t == null) return;
      const meta = candleMetaRef.current.get(t);
      if (!meta) return;
      const d = decimalsRef.current;
      const o = fmt(meta.o, d);
      const h = fmt(meta.h, d);
      const l = fmt(meta.l, d);
      const c = fmt(meta.c, d);
      const v = Number.isFinite(meta.v) ? String(Math.round(meta.v)) : '—';
      const delta = Number.isFinite(meta.delta) ? String(Math.round(meta.delta)) : '—';
      const ai = aiRef.current != null ? `${Math.round(aiRef.current * 100)}%` : '—';
      el.textContent = `O ${o}  H ${h}  L ${l}  C ${c}  V ${v}  Δ ${delta}  AI ${ai}`;
    };

    chart.subscribeCrosshairMove(onCrosshair);

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      chart.applyOptions({
        width: Math.max(1, Math.floor(cr.width)),
        height: Math.max(1, Math.floor(cr.height)),
      });
    });
    ro.observe(host);
    roRef.current = ro;

    setReady(true);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      try {
        ro.disconnect();
      } catch {}
      roRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      fastSeriesRef.current = null;
      slowSeriesRef.current = null;
      volumeSeriesRef.current = null;
      fibLinesRef.current = [];
      liveLineRef.current = null;
      didFitRef.current = false;
      fitKeyRef.current = '';
      setReady(false);
    };
  }, [isForex]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    const fast = fastSeriesRef.current;
    const slow = slowSeriesRef.current;
    if (!chart || !candleSeries || !volume || !fast || !slow) return;

    const seriesData = mode === 'volume_delta' ? candleDelta : candleStandard;
    candleSeries.setData(seriesData);
    volume.setData(volumeHist);

    const raw = Array.isArray(data?.candles) ? data.candles : [];
    const fastData = raw.filter((c) => c.sma_fast != null).map((c) => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_fast }));
    const slowData = raw.filter((c) => c.sma_slow != null).map((c) => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_slow }));
    fast.setData(fastData);
    slow.setData(slowData);

    candleSeries.setMarkers(markers);

    fibLinesRef.current.forEach((line) => {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        return;
      }
    });
    fibLinesRef.current = [];
    if (showFibs && fibLevels.length > 0) {
      fibLinesRef.current = fibLevels.map((f) => candleSeries.createPriceLine(f));
    }

    if (liveLineRef.current) {
      try {
        candleSeries.removePriceLine(liveLineRef.current);
      } catch {
        return;
      }
      liveLineRef.current = null;
    }
    if (seriesData.length > 0) {
      const last = seriesData[seriesData.length - 1];
      if (last && typeof last.close === 'number') {
        liveLineRef.current = candleSeries.createPriceLine({
          price: last.close,
          color: 'rgba(0, 255, 163, 0.55)',
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: 'LIVE',
        });
      }
    }

    const nextFitKey = `${String(data?.ticker || '')}:${String(data?.interval || '')}:${isForex ? 'fx' : 'eq'}`;
    if (fitKeyRef.current !== nextFitKey) {
      fitKeyRef.current = nextFitKey;
      didFitRef.current = false;
    }
    if (!didFitRef.current && seriesData.length > 0) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
    }

    chart.applyOptions({
      watermark: {
        visible: true,
        fontSize: 48,
        horzAlign: 'center',
        vertAlign: 'center',
        color: 'rgba(255, 255, 255, 0.06)',
        text: watermarkText,
      },
    });
  }, [candleDelta, candleStandard, data?.candles, data?.interval, data?.ticker, fibLevels, isForex, markers, mode, showFibs, volumeHist, watermarkText]);

  return (
    <DrawingsProvider>
      <div className="w-full h-full flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="text-[11px] font-mono text-neutral-500 whitespace-nowrap">
            {data ? `${String(data.asset_class || '').toUpperCase()} · ${data.rendered_candles}/${data.total_candles}` : 'Awaiting backtest…'}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center rounded-xl border border-neutral-800 bg-space-950/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setMode('standard')}
                className={`h-9 px-3 text-[11px] tracking-widest font-mono transition-all ${mode === 'standard' ? 'text-neutral-100 bg-white/5' : 'text-neutral-400 hover:text-neutral-200'}`}
              >
                STANDARD
              </button>
              <button
                type="button"
                onClick={() => setMode('volume_delta')}
                className={`h-9 px-3 text-[11px] tracking-widest font-mono transition-all ${mode === 'volume_delta' ? 'text-[#00FFA3] bg-[#00FFA3]/10' : 'text-neutral-400 hover:text-neutral-200'}`}
              >
                DELTA
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowFibs((v) => !v)}
              className={`h-9 px-3 rounded-xl border text-[11px] tracking-widest font-mono transition-all ${
                showFibs
                  ? 'border-[#FFD700]/60 text-[#FFD700] bg-[#FFD700]/10 shadow-[0_0_18px_rgba(255,215,0,0.18)]'
                  : 'border-neutral-800 text-neutral-300 bg-space-950/40 hover:text-neutral-100 hover:border-neutral-700'
              }`}
            >
              {showFibs ? 'HIDE FIBS' : 'SHOW FIBS'}
            </button>

            <DrawingToolbar className="hidden md:flex" />

            <button
              type="button"
              onClick={onToggleFullscreen}
              className="h-9 px-3 rounded-xl border border-neutral-800 bg-space-950/40 text-[11px] tracking-widest text-neutral-300 hover:text-neutral-100 hover:border-neutral-700 transition-all whitespace-nowrap"
            >
              {isFullscreen ? 'EXIT FULL' : 'FULL SCREEN'}
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 rounded-2xl border border-neutral-800 bg-black/20 overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0"
          />
          <div
            ref={legendRef}
            className="absolute left-3 top-3 z-10 rounded-xl border border-neutral-800 bg-space-950/70 px-3 py-2 text-[11px] font-mono text-neutral-200 backdrop-blur-xl"
          />
          {ready && chartRef.current && candleSeriesRef.current ? (
            <DrawingOverlayCanvas chart={chartRef.current} candleSeries={candleSeriesRef.current} hostRef={containerRef} />
          ) : null}
        </div>
      </div>
    </DrawingsProvider>
  );
}

export default memo(AdvancedProChart);
