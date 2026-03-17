import React, { memo, useEffect, useMemo, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

function FastChart({ data, isForex }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const deltaRef = useRef(null);
  const roRef = useRef(null);

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
    if (candles.length > 0) chartRef.current.timeScale().fitContent();
  }, [candles, deltaHist]);

  return <div ref={hostRef} className="w-full h-full" />;
}

export default memo(FastChart);

