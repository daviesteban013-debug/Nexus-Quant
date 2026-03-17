import React, { memo, useEffect, useMemo, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

function intervalToSeconds(interval) {
  const v = String(interval || '').trim();
  if (v === '1m') return 60;
  if (v === '5m') return 300;
  if (v === '15m') return 900;
  if (v === '1h') return 3600;
  if (v === '4h') return 14400;
  if (v === '1d') return 86400;
  return 60;
}

function FastChart({ data, isForex }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const deltaRef = useRef(null);
  const roRef = useRef(null);
  const socketRef = useRef(null);
  const lastCandleRef = useRef(null);
  const intervalSecRef = useRef(60);

  const { candles, deltaHist } = useMemo(() => {
    const src = Array.isArray(data?.candles) ? data.candles : [];
    const c = src.map((x) => ({
      time: new Date(x.x).getTime() / 1000,
      open: x.o,
      high: x.h,
      low: x.l,
      close: x.c,
    }));

    const h = src.map((x) => {
      const delta = typeof x.volume_delta === 'number' ? x.volume_delta : (x.buy_volume ?? 0) - (x.sell_volume ?? 0);
      const up = delta >= 0;
      return {
        time: new Date(x.x).getTime() / 1000,
        value: delta,
        color: up ? '#00FFA3' : '#FF3B30',
      };
    });

    return { candles: c, deltaHist: h };
  }, [data?.candles]);

  const markers = useMemo(() => {
    const trades = Array.isArray(data?.trades) ? data.trades : [];
    return trades.map((t) => {
      const isBuy = String(t.type || '').includes('BUY') || String(t.type || '').includes('COVER');
      return {
        time: new Date(t.date).getTime() / 1000,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#00FFA3' : '#FF3B30',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: isBuy ? 'BUY' : 'SELL',
      };
    });
  }, [data?.trades]);

  useEffect(() => {
    intervalSecRef.current = intervalToSeconds(data?.interval);
  }, [data?.interval]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      width: Math.max(1, Math.floor(host.clientWidth)),
      height: Math.max(1, Math.floor(host.clientHeight)),
      layout: {
        background: { type: 'solid', color: '#000000' },
        textColor: '#00FFA3',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: { mode: 1 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00FFA3',
      downColor: '#FF3B30',
      borderVisible: false,
      wickUpColor: '#00FFA3',
      wickDownColor: '#FF3B30',
      priceFormat: {
        type: 'price',
        precision: isForex ? 5 : 2,
        minMove: isForex ? 0.00001 : 0.01,
      },
    });

    const deltaSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'delta',
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale('delta').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    deltaRef.current = deltaSeries;

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

    return () => {
      try {
        ro.disconnect();
      } catch {}
      roRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      deltaRef.current = null;
    };
  }, [isForex]);

  useEffect(() => {
    if (!candleRef.current || !deltaRef.current) return;
    candleRef.current.setData(candles);
    deltaRef.current.setData(deltaHist);
    candleRef.current.setMarkers(markers);
    if (candles.length > 0) {
      chartRef.current.timeScale().fitContent();
      lastCandleRef.current = { ...candles[candles.length - 1] };
    } else {
      lastCandleRef.current = null;
    }
  }, [candles, deltaHist, markers]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    const assetClass = data?.asset_class || 'stocks';
    const symbol = data?.ticker || 'AAPL';
    const base = (process.env.NODE_ENV === 'production')
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
      : 'ws://localhost:8000';

    const params = new URLSearchParams({
      ticker: symbol,
      asset_class: assetClass,
    });
    const url = `${base}/ws/live?${params.toString()}`;

    try {
      if (socketRef.current) {
        socketRef.current.close();
      }
    } catch {}

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type !== 'LIVE_TICK') return;
        const price = Number(msg.price);
        const ts = Number(msg.timestamp);
        if (!Number.isFinite(price) || !Number.isFinite(ts)) return;

        const intervalSec = intervalSecRef.current || 60;
        const bucket = Math.floor(ts / intervalSec) * intervalSec;

        const last = lastCandleRef.current;
        if (!last || typeof last.time !== 'number') return;

        if (bucket > last.time) {
          const next = { time: bucket, open: price, high: price, low: price, close: price };
          lastCandleRef.current = next;
          series.update(next);
          return;
        }

        if (bucket < last.time) return;

        const next = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };
        lastCandleRef.current = next;
        series.update(next);
      } catch {
        return;
      }
    };

    ws.onclose = () => {
      if (socketRef.current === ws) socketRef.current = null;
    };

    return () => {
      try {
        ws.close();
      } catch {}
      if (socketRef.current === ws) socketRef.current = null;
    };
  }, [data?.asset_class, data?.ticker]);

  return <div ref={hostRef} className="w-full h-full" />;
}

export default memo(FastChart);
